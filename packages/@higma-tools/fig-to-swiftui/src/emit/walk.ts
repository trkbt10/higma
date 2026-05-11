/**
 * @file Walk a FigNode tree and produce a SwiftUI view tree.
 *
 * The walker runs in three modes that match the Figma container kinds:
 *
 *   1. **Autolayout frame** (`stackMode = HORIZONTAL | VERTICAL`)
 *      → emits `HStack` / `VStack` with each child rendered in flow
 *        order; primary distribution drives Spacer insertion.
 *
 *   2. **Plain frame / group / component / instance**
 *      → emits a `ZStack(alignment: .topLeading)` and renders each
 *        child with an explicit `.offset(x:, y:)` derived from the
 *        child's `transform.m02 / m12` so absolute positioning
 *        survives the conversion.
 *
 *   3. **Leaf primitive** (TEXT, RECTANGLE, ELLIPSE, VECTOR)
 *      → emits a single SwiftUI primitive (`Text`, `Rectangle`,
 *        `Ellipse`, etc.) with style modifiers applied.
 *
 * Out-of-scope leaf kinds (vectors with arbitrary path data, image
 * fills, gradients) hit a Fail-Fast `throw` so the consumer can
 * address them rather than silently rendering an empty placeholder.
 */
import type { FigImagePaint, FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren, type FigBlob } from "@higma-document-models/fig/domain";
import { resolveInstanceNode } from "@higma-document-models/fig/symbols";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { LayoutPlan } from "../layout/autolayout";
import { planLayout } from "../layout/autolayout";
import { emitLineLeaf } from "./line";
import { emitEllipseArcOrDonut, isEllipseArcOrDonut } from "./ellipse-arc";
import { emitGeometryLeaf } from "./geometry";
import { tryComposeBooleanLeaf } from "./boolean-compose";
import {
  contentModeFor,
  firstVisibleImagePaint,
  imageBundleExpr,
  imageInlineExpr,
  imageSlug,
  resolveImageRef,
} from "../style/image";
import { solidPaintToColor as solidPaintToColorImported } from "../style/color";
import { gradientExpr as gradientExprImported } from "../style/gradient";

/**
 * Optional resources passed to the walker.
 *
 *   - `blobs` — backing storage for `commandsBlob` indices on
 *     geometry-driven nodes (VECTOR / STAR / REGULAR_POLYGON).
 *   - `images` — backing storage for `IMAGE` paints; keyed by
 *     `imageRef`. The walker base64-encodes the bytes inline into
 *     the emitted Swift source.
 *   - `symbolMap` — `{guid → FigNode}` lookup used by INSTANCE
 *     expansion. When set, the walker resolves each INSTANCE via
 *     `resolveInstanceNode` and emits the merged node + its
 *     SYMBOL-derived children. When omitted, INSTANCE nodes emit
 *     their literal direct children (typically empty).
 *
 * All are optional; when an emit step needs a missing resource
 * it surfaces a Fail-Fast error rather than silently dropping
 * the node.
 */
export type EmitContext = {
  readonly blobs?: readonly FigBlob[];
  readonly images?: ReadonlyMap<string, FigPackageImage>;
  readonly symbolMap?: ReadonlyMap<string, FigNode>;
  /**
   * Lookup `nodeKey → resource-slug` for nodes that the CLI has
   * already rasterised to a PNG bundle resource. When the walker
   * encounters such a node it emits a single
   * `Image("<slug>", bundle: .module).resizable().frame(...)` leaf
   * instead of recursing into the node's children — sidestepping
   * SwiftUI's super-linear `body` type-check on path-heavy
   * subtrees. `nodeKey` is the canonical `${sessionID}:${localID}`
   * format produced by `rasterize.ts → nodeKey()`.
   */
  readonly rasterizedSubtrees?: ReadonlyMap<string, string>;
  /**
   * How IMAGE paint bytes are referenced from the emitted SwiftUI:
   *
   *   - `"bundle"` (default) — `Image("<slug>", bundle: .module)`.
   *     The CLI writes the bytes to `<out>/Resources/<slug>.png`
   *     and `Package.swift` declares `Resources/` as a `.process`
   *     resource folder. This is the production path — produces
   *     small Swift sources that compile cleanly into a real app.
   *
   *   - `"inline"` — `makeFigToSwiftuiImage(data: Data(base64Encoded:
   *     "..."))` with the bytes embedded in the source. This is the
   *     visual-roundtrip spec harness path: it compiles a single
   *     .swift file with `swift CLI` and has no `Bundle.module`
   *     available, so the only way to ship the image bytes is in
   *     the source itself. Verbose but self-contained.
   *
   * The walker picks between the two via this option; the file
   * emitter (`file.ts`) injects the `makeFigToSwiftuiImage`
   * helper only when the body actually references it.
   */
  readonly imageEmbedding?: "bundle" | "inline";
};
import {
  backgroundBlurModifier,
  backgroundModifier,
  backgroundWithShadowsModifier,
  blurModifier,
  compositingGroupModifier,
  cornerRadiusModifier,
  extraFillBackgroundModifiers,
  fillModifier,
  fontModifier,
  foregroundColorModifier,
  frameModifier,
  hasVisibleFillPaint,
  innerShadowOverlayModifiers,
  offsetModifier,
  opacityModifier,
  paddingModifier,
  rotationModifier,
  shadowModifiers,
  spacerExpr,
  strokeOverlayModifier,
} from "../style/modifiers";
import { shapeExprFor } from "../style/shape";
import {
  arg,
  call,
  leaf,
  member,
  modifier,
  namedArg,
  num,
  stack,
  str,
  type Modifier,
  type StackKind,
  type SwiftAlignment,
  type SwiftCallArg,
  type SwiftExpr,
  type SwiftView,
} from "../swift-tree";

const TEXT_TYPE = "TEXT";
const RECTANGLE_TYPE = "RECTANGLE";
const ROUNDED_RECTANGLE_TYPE = "ROUNDED_RECTANGLE";
const ELLIPSE_TYPE = "ELLIPSE";
const FRAME_LIKE_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "GROUP",
  "INSTANCE",
  "SECTION",
  // SYMBOL is the on-disk encoding of the Figma UI concept "Component"
  // (the canonical schema has no COMPONENT or COMPONENT_SET NodeType;
  // see `docs/refactor/component-type-cleanup.md`). The walker treats
  // SYMBOLs as frame-like containers when they appear as a top-level
  // emit target — design-system fig files keep their reusable parts as
  // canvas-level SYMBOLs (e.g. Win98 "Button/Text/Regular") and need
  // to render the same way a FRAME does. Nested INSTANCE → SYMBOL
  // resolution goes through `resolveInstanceFor`, which returns the
  // merged node + children. A "Component Set" / "Variant Set" is a
  // FRAME carrying variant metadata — already covered by the FRAME
  // case here.
  "SYMBOL",
]);

/**
 * Compose the modifier chain for a frame-like container node.
 *
 * Containers paint their fill via `.background(Color)` so the colour
 * lands behind the children. The order — padding → frame → background →
 * stroke overlay → cornerRadius → shadow → rotation → opacity —
 * matches SwiftUI's canonical paint chain for an authored container:
 *
 *   1. `.padding(...)` insets the children inside the frame.
 *   2. `.frame(width:height:alignment:.topLeading)` forces the
 *      container's outer size to the Figma-authored size — without
 *      this the container shrinks to the children's natural extent
 *      and absolute-positioned (`.offset`) children lose their
 *      authored origin (Figma's transform-relative positioning is
 *      measured from the frame's top-left, not the children's bbox).
 *   3. `.background(Color)` paints the fill across the whole framed
 *      region — applying it before `.frame(...)` would size the
 *      background to the children's natural extent and leave the
 *      surrounding area transparent.
 *   4. `.overlay(<shape>().strokeBorder(Color, lineWidth: w))` paints
 *      the container's stroke. The overlay reuses the same silhouette
 *      `.background(...)` painted, so the stroke follows the rounded
 *      corners (when present). Must come *before* the clip so the
 *      stroke isn't clipped by `.cornerRadius` (which would shave the
 *      half of the stroke that lies outside the rounded path).
 *   5. `.cornerRadius(...)` clips the filled+stroked container.
 *      Skipped when the container has no rounded corners *or* when the
 *      stroke overlay already carries the corner shape — `strokeBorder`
 *      respects the silhouette of the shape it's attached to, and the
 *      `.background(Color)` on the framed region is already inside the
 *      framed bounds, so an additional clip is redundant.
 *   6. `.shadow(...)` drops the shadow on the clipped silhouette.
 *   7. `.rotationEffect(...)` rotates around the view centre.
 *   8. `.opacity(...)` is global and is applied last.
 */
/**
 * Choose the right background modifier for a frame-like container:
 * baked-in drop shadow when the node has both a fill paint and at
 * least one DROP_SHADOW effect (so the shape's `.shadow(...)`
 * paints OUTSIDE the silhouette without leaking inside via the
 * outer view's alpha mask), or the bare `.background(<paint>)` when
 * neither condition holds.
 */
function pickBackgroundModifier(node: FigNode, useBakedShadow: boolean): Modifier | undefined {
  if (useBakedShadow) {
    return backgroundWithShadowsModifier(node);
  }
  return backgroundModifier(node);
}

/**
 * True when the node is a Figma container whose default behaviour
 * is to clip its children to its silhouette. FRAME / INSTANCE /
 * SECTION / SYMBOL clip by default; GROUP nodes do NOT clip —
 * they're transparent passthrough containers. The canonical schema
 * has no COMPONENT / COMPONENT_SET NodeType (see
 * `docs/refactor/component-type-cleanup.md`). The Figma model
 * exposes the field as `frameMaskDisabled` (truthy = clipping
 * disabled) and `clipsContent` (the canonical clipping flag,
 * defaulting to true for frames). We accept either.
 */
function shouldClipFrame(node: FigNode): boolean {
  const t = node.type.name;
  if (t === "GROUP" || t === "BOOLEAN_OPERATION") {
    return false;
  }
  if (t !== "FRAME" && t !== "SYMBOL" && t !== "INSTANCE" && t !== "SECTION") {
    return false;
  }
  const maskDisabled = (node as { frameMaskDisabled?: boolean }).frameMaskDisabled;
  if (maskDisabled === true) {
    return false;
  }
  const clipsContent = (node as { clipsContent?: boolean }).clipsContent;
  if (clipsContent === false) {
    return false;
  }
  return true;
}

/**
 * Build the `.clipShape(<silhouette>())` modifier that clips a
 * frame's children to its silhouette. Uses `shapeExprFor` so the
 * clip path follows the node's corner radius (rounded rectangle for
 * non-zero `cornerRadius`, plain `Rectangle` otherwise).
 */
function clipShapeModifier(node: FigNode): Modifier {
  const shape = shapeExprFor(node);
  return modifier("clipShape", [{ value: shape }]);
}

function containerModifiers(
  node: FigNode,
  plan: LayoutPlan,
  childCount: number,
): readonly Modifier[] {
  const mods: Modifier[] = [];
  const padMod = paddingModifier(plan.padding);
  if (padMod) {
    mods.push(padMod);
  }
  const frame = frameModifier(node, frameAlignmentForPlan(plan));
  if (frame) {
    mods.push(frame);
  }
  const shadows = shadowModifiers(node);
  const hasFill = hasVisibleFillPaint(node.fillPaints);
  const useBakedShadow = shadows.length > 0 && hasFill;
  // Figma frames (FRAME / SYMBOL / INSTANCE / SECTION) clip
  // their content by default unless `frameMaskDisabled === true`.
  // SwiftUI's `ZStack` doesn't clip children automatically; we
  // emit an explicit `.clipShape(<silhouette>)` so any child
  // whose drawn extent (including drop shadows) leaks past the
  // frame silhouette gets cut off — the canonical reproduction
  // is the `clip-shadow` fixture, where Figma's clip stops a
  // child's shadow at the inner frame edge while SwiftUI's
  // unclipped ZStack lets the shadow spill into the surrounding
  // gray canvas. GROUP nodes don't get the clip — Figma renders
  // groups as transparent passthrough, never as clipping
  // containers.
  const wantsFrameClip = shouldClipFrame(node);
  // INNER_SHADOW sits inside the silhouette, so the overlay must run
  // *before* the corner-radius clip removes the corners — otherwise
  // the masked-stroke trick paints over already-clipped pixels.
  // We push it BEFORE clipShape so the stroke-trick paints inside
  // the visible foreground area before the clip cuts the rest.
  for (const inner of innerShadowOverlayModifiers(node)) {
    mods.push(inner);
  }
  const stroke = strokeOverlayModifier(node);
  if (stroke) {
    mods.push(stroke);
  }
  // Apply the foreground clip BEFORE `.background(...)` and
  // `.shadow(...)`. SwiftUI's `.background(_)` is appended outside
  // any earlier `.clipShape(_)`, so the bg layer is NOT clipped by
  // the foreground silhouette — the bg's own `.shadow(...)`
  // (`backgroundWithShadowsModifier`) renders outside the silhouette
  // unimpeded. Without this ordering the outer-chain `.shadow(...)`
  // would attach to the alpha mask of "ZStack + clipped foreground
  // + bg" and we'd lose the outside-of-silhouette shadow.
  if (wantsFrameClip) {
    mods.push(clipShapeModifier(node));
  }
  // Drop-shadow placement on a container: bake the shadow into the
  // bg shape via `backgroundWithShadowsModifier` so SwiftUI's
  // `.shadow(...)` paints OUTSIDE the silhouette only. Falls back
  // to the bare `.background(<paint>)` form when the node has no
  // fill or no shadow.
  const bg = pickBackgroundModifier(node, useBakedShadow);
  if (bg) {
    mods.push(bg);
  }
  // BACKGROUND_BLUR samples the backdrop *behind* the frame, so it
  // belongs after the solid fill (so the fill overlays the blurred
  // material) but before stroke / inner shadow / clip.
  const bgBlur = backgroundBlurModifier(node);
  if (bgBlur) {
    mods.push(bgBlur);
  }
  // Apply outer `.cornerRadius(r)` only when neither the bg shape
  // nor the foreground clipShape has already imposed the corner
  // radius. The bg-with-shadow form embeds the radius in its own
  // shape; the frame-clip emits `<rounded>()` when the node has a
  // corner radius. Both paths obviate an outer corner-radius clip,
  // and emitting one anyway would cut off the bg shape's outside
  // shadow.
  if (!useBakedShadow && !wantsFrameClip) {
    const radius = cornerRadiusModifier(node);
    if (radius) {
      mods.push(radius);
    }
  }
  // Apply outer `.shadow(...)` modifiers only when we couldn't bake
  // the drop shadow into the bg shape (no fill paint, so no
  // silhouette to bind it to). With a bg fill, baking is preferred —
  // the shadow then lives inside the shape's own paint chain and
  // doesn't leak through the fill or attach to children.
  if (!useBakedShadow) {
    for (const shadow of shadows) {
      mods.push(shadow);
    }
  }
  const blur = blurModifier(node);
  if (blur) {
    mods.push(blur);
  }
  const rotation = rotationModifier(node);
  if (rotation) {
    mods.push(rotation);
  }
  const opacity = opacityModifier(node);
  if (opacity) {
    // For multi-child containers `.opacity(α)` would attenuate each
    // child independently, producing additive blending in overlaps —
    // the inverse of Figma's group-opacity semantic. Inserting
    // `.compositingGroup()` first flattens the container before alpha
    // is applied so the rendered behaviour matches Figma. Single-child
    // containers don't need it (no overlapping siblings to blend).
    if (childCount > 1) {
      mods.push(compositingGroupModifier());
    }
    mods.push(opacity);
  }
  return mods;
}

/**
 * Compute the `.frame(alignment:)` value that anchors a stack's
 * intrinsic content inside its outer frame.
 *
 *   - ZStack: always `.topLeading` — children carry their own
 *     `.offset(...)` and assume a top-left origin.
 *   - HStack: cross-axis is vertical; primary-axis Spacer insertion
 *     already fills horizontal space when primary != MIN, so the
 *     horizontal anchor matters only for primary=MIN where the HStack
 *     is intrinsically narrower than the frame.
 *   - VStack: symmetric to HStack with axes swapped.
 *
 * The matrix below collapses the (primary × counter) Figma combo to a
 * single `SwiftAlignment` — see the comment block at the top of this
 * function for the full table. `SPACE_BETWEEN` on primary doesn't
 * shift the horizontal anchor (the Spacers already span the gap), but
 * we still need a sensible fallback for cases where the stack's
 * intrinsic axis is narrower than the frame; the matrix treats it as
 * `MIN` since the leading Spacer already pushes the first child away
 * from the leading edge.
 */
function frameAlignmentForPlan(plan: LayoutPlan): SwiftAlignment {
  if (plan.stack === "ZStack") {
    return "topLeading";
  }
  if (plan.stack === "HStack") {
    const counter = plan.alignment ?? "top";
    switch (plan.primary) {
      case "min":
      case "space-between":
        return horizontalLeadingFor(counter);
      case "center":
        return horizontalCenterFor(counter);
      case "max":
        return horizontalTrailingFor(counter);
    }
  }
  // VStack
  const counter = plan.alignment ?? "leading";
  switch (plan.primary) {
    case "min":
    case "space-between":
      return verticalTopFor(counter);
    case "center":
      return verticalCenterFor(counter);
    case "max":
      return verticalBottomFor(counter);
  }
}

function horizontalLeadingFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "leading";
  }
  if (counter === "bottom") {
    return "bottomLeading";
  }
  return "topLeading";
}

function horizontalCenterFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "center";
  }
  if (counter === "bottom") {
    return "bottom";
  }
  return "top";
}

function horizontalTrailingFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "trailing";
  }
  if (counter === "bottom") {
    return "bottomTrailing";
  }
  return "topTrailing";
}

function verticalTopFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "top";
  }
  if (counter === "trailing") {
    return "topTrailing";
  }
  return "topLeading";
}

function verticalCenterFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "center";
  }
  if (counter === "trailing") {
    return "trailing";
  }
  return "leading";
}

function verticalBottomFor(counter: SwiftAlignment): SwiftAlignment {
  if (counter === "center") {
    return "bottom";
  }
  if (counter === "trailing") {
    return "bottomTrailing";
  }
  return "bottomLeading";
}

/**
 * Compose the modifier chain for a shape leaf with a fill (RECTANGLE,
 * ROUNDED_RECTANGLE, ELLIPSE).
 *
 * `Rectangle()` / `Ellipse()` / `RoundedRectangle()` paint themselves
 * in the foreground colour by default; the fill must use `.fill(Color)`
 * rather than `.background(Color)`. `.background(...)` paints *behind*
 * the foreground, so a missing `.fill(...)` leaves a black shape on
 * top of the requested colour.
 *
 * Order: fill → stroke overlay → frame → shadow → rotation → opacity.
 * The stroke overlay must go directly after the fill so the outline
 * paints on the same silhouette before the frame establishes the
 * outer bounding box. Putting the frame first would lock the shape's
 * intrinsic size to its container and make `.fill` paint over a
 * stretched silhouette.
 */
function shapeModifiers(node: FigNode): readonly Modifier[] {
  const mods: Modifier[] = [];
  const fill = fillModifier(node);
  if (fill) {
    mods.push(fill);
  }
  // Multi-paint stacks: the topmost paint is consumed by
  // `fillModifier` above, the rest are layered behind via
  // `.background(<shape>().fill(<paint>))` overlays so the
  // composited result matches Figma's back-to-front blending.
  for (const layer of extraFillBackgroundModifiers(node)) {
    mods.push(layer);
  }
  // INNER_SHADOW overlay must paint between the fill and the stroke
  // — Figma's compositor lays inner shadow over the fill but under
  // the stroke, and the `.mask(<shape>)` inside the overlay clips
  // it cleanly to the shape.
  for (const inner of innerShadowOverlayModifiers(node)) {
    mods.push(inner);
  }
  const stroke = strokeOverlayModifier(node);
  if (stroke) {
    mods.push(stroke);
  }
  const frame = frameModifier(node);
  if (frame) {
    mods.push(frame);
  }
  // shadow / blur / opacity must come AFTER `.frame(...)`. SwiftUI
  // applies effects to whatever extent the upstream chain produced;
  // a `.blur(...)` on `Ellipse().fill(...)` (without a frame) operates
  // on the shape's intrinsic 0-size content and produces no visible
  // blur. Pinning the size via `.frame(...)` first gives the effects
  // a real region to operate on.
  for (const shadow of shadowModifiers(node)) {
    mods.push(shadow);
  }
  const blur = blurModifier(node);
  if (blur) {
    mods.push(blur);
  }
  const opacity = opacityModifier(node);
  if (opacity) {
    mods.push(opacity);
  }
  const rotation = rotationModifier(node);
  if (rotation) {
    mods.push(rotation);
  }
  return mods;
}

/** Modifiers a TEXT node emits — frame/background/radius do not apply. */
function textModifiers(node: FigNode): readonly Modifier[] {
  const mods: Modifier[] = [];
  const font = fontModifier(node);
  if (font) {
    mods.push(font);
  }
  const fg = foregroundColorModifier(node);
  if (fg) {
    mods.push(fg);
  }
  const opacity = opacityModifier(node);
  if (opacity) {
    mods.push(opacity);
  }
  const frame = frameModifier(node);
  if (frame) {
    mods.push(frame);
  }
  return mods;
}

/** Render a node and apply the parent-driven offset modifier when needed. */
type Placement = { readonly mode: "flow" } | { readonly mode: "absolute"; readonly x: number; readonly y: number };

function withPlacement(view: SwiftView, placement: Placement): SwiftView {
  if (placement.mode === "flow") {
    return view;
  }
  const off = offsetModifier(placement.x, placement.y);
  if (!off) {
    return view;
  }
  if (view.kind === "stack") {
    return { ...view, modifiers: [...view.modifiers, off] };
  }
  return { ...view, modifiers: [...view.modifiers, off] };
}

function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  return true;
}

/** Read children that are rendered (visible) for the walker. */
function renderedChildren(node: FigNode, ctx?: EmitContext): readonly FigNode[] {
  return resolveInstanceFor(node, ctx).children.filter(isRendered);
}

/**
 * If the node is an INSTANCE and the context carries a symbolMap,
 * resolve it through the canonical helper and return both the
 * merged node (carrying the SYMBOL's properties — fillPaints, size,
 * etc., with INSTANCE-level overrides folded in) and the resolved
 * children. For non-INSTANCE nodes (or when no symbolMap is
 * available) returns the input unchanged.
 */
function resolveInstanceFor(node: FigNode, ctx?: EmitContext): {
  readonly node: FigNode;
  readonly children: readonly FigNode[];
} {
  if (ctx?.symbolMap && node.type.name === "INSTANCE") {
    return resolveInstanceNode(node, { symbolMap: ctx.symbolMap });
  }
  if (node.type.name === "BOOLEAN_OPERATION") {
    return { node, children: inheritFillsToBooleanChildren(node) };
  }
  return { node, children: safeChildren(node) };
}

/**
 * Figma stores boolean-op fillPaints on the BOOLEAN_OPERATION node
 * itself; the children are pure path contributors with no fill of
 * their own. Without the actual boolean math we render the children
 * as a ZStack fallback; for that to look right each child needs to
 * paint with the parent's fill. We synthesise that by cloning each
 * child with the parent's `fillPaints` / `strokePaints` /
 * `strokeWeight` / `strokeAlign` injected when the child carries no
 * fill of its own. (A child may already have its own paint when the
 * fixture overrides it.)
 */
function inheritFillsToBooleanChildren(parent: FigNode): readonly FigNode[] {
  const children = safeChildren(parent);
  const parentFill = parent.fillPaints;
  const parentStrokes = parent.strokePaints;
  const parentStrokeWeight = parent.strokeWeight;
  const parentStrokeAlign = parent.strokeAlign;
  return children.map((c) => {
    const next: FigNode = { ...c };
    if ((!c.fillPaints || c.fillPaints.length === 0) && parentFill && parentFill.length > 0) {
      Object.assign(next, { fillPaints: parentFill });
    }
    if ((!c.strokePaints || c.strokePaints.length === 0) && parentStrokes && parentStrokes.length > 0) {
      Object.assign(next, {
        strokePaints: parentStrokes,
        strokeWeight: parentStrokeWeight,
        strokeAlign: parentStrokeAlign,
      });
    }
    return next;
  });
}

/**
 * Decide whether a child is positioned absolutely inside its parent.
 * In an autolayout parent (HStack/VStack) children flow unless they
 * carry `stackPositioning = ABSOLUTE`. In a non-autolayout parent
 * (ZStack) every child is absolute.
 */
function placementFor(child: FigNode, parent: LayoutPlan): Placement {
  if (parent.stack === "ZStack") {
    const x = child.transform?.m02 ?? 0;
    const y = child.transform?.m12 ?? 0;
    return { mode: "absolute", x, y };
  }
  if (child.stackPositioning?.name === "ABSOLUTE") {
    const x = child.transform?.m02 ?? 0;
    const y = child.transform?.m12 ?? 0;
    return { mode: "absolute", x, y };
  }
  return { mode: "flow" };
}

/**
 * Inject Spacer() values around children to realise primary-axis
 * distribution. SwiftUI's HStack/VStack don't expose primary alignment,
 * so center / max / space-between are encoded via leading and/or
 * trailing Spacer() siblings.
 */
function applyPrimaryDistribution(
  plan: LayoutPlan,
  children: readonly SwiftView[],
): readonly SwiftView[] {
  if (plan.stack === "ZStack" || children.length === 0) {
    return children;
  }
  switch (plan.primary) {
    case "min":
      return children;
    case "center":
    case "max":
      // Figma keeps `stackSpacing` between children even with
      // CENTER / MAX primary alignment — only the *position* of
      // the packed group changes. SwiftUI realises that via
      // `.frame(width:..., alignment:)` (set by
      // `frameAlignmentForPlan`), so we don't need leading /
      // trailing Spacers. Inserting Spacers would force the
      // HStack's spacing to also apply between rect↔Spacer pairs,
      // pushing content past the frame edge for fixtures that
      // already fill the available extent (auto-h-center has
      // 3×40 + 2×10 = 140 = full width; with Spacers
      // SwiftUI would over-allocate by 20px).
      return children;
    case "space-between": {
      if (children.length < 2) {
        return [leaf(spacerExpr()), ...children];
      }
      const out: SwiftView[] = [];
      children.forEach((child, idx) => {
        if (idx > 0) {
          out.push(leaf(spacerExpr()));
        }
        out.push(child);
      });
      return out;
    }
  }
}

/**
 * Render a TEXT node. Only the `textData.characters` / `characters`
 * channel is consulted; per-run styling is not yet in scope and is
 * surfaced as a TODO comment via the layered modifiers (a future
 * iteration can split a TEXT into multiple `Text` instances joined by
 * `+` to realise per-run styling).
 */
function emitTextNode(node: FigNode): SwiftView {
  const characters = readTextCharacters(node);
  return leaf(call("Text", [{ value: str(characters) }]), textModifiers(node));
}

function readTextCharacters(node: FigNode): string {
  if (typeof node.textData?.characters === "string") {
    return node.textData.characters;
  }
  if (typeof node.characters === "string") {
    return node.characters;
  }
  return "";
}

/**
 * Render a RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE leaf — those map to
 * SwiftUI's `Rectangle()`, `RoundedRectangle(cornerRadius:)`, and
 * `Ellipse()` respectively. The shape constructor itself encodes the
 * corner radius (when present) so the silhouette feeds both the
 * `.fill(...)` and the stroke overlay's outline path consistently.
 *
 * Stroke-only shapes (no SOLID fill, but a SOLID stroke) are valid in
 * Figma and authored explicitly in the rectangle fixture's
 * "Stroke Only" frame — those emit a bare `<shape>().strokeBorder(...)`
 * with no `.fill(...)` so the path-stroke view paints alone instead
 * of being overlaid on a default-foreground fill.
 *
 * A node with neither fill nor stroke is reported as Fail-Fast: it
 * would render as transparent in Figma but as black-on-default in
 * SwiftUI without `.fill(...)`, which is wrong on every count. (A future
 * iteration could emit `Color.clear` for that path.)
 */
/**
 * Pick the right `Image(...)` expression for the requested
 * `imageEmbedding` mode. `bundle` returns
 * `Image("<slug>", bundle: .module)`; `inline` returns the
 * base64-decoder helper invocation. Extracted to a function so the
 * call site stays a single statement (no inline ternary).
 */
function pickImageExpr(
  mode: "bundle" | "inline",
  image: FigPackageImage,
  ref: string,
): SwiftExpr {
  if (mode === "inline") {
    return imageInlineExpr(image);
  }
  return imageBundleExpr(imageSlug(ref));
}

/**
 * Build an `Image(...).resizable().aspectRatio(...).clipShape(...)`
 * leaf when the node carries a usable IMAGE fill. Returns undefined
 * when no image paint is present, when the paint references an
 * imageRef the context didn't bring along, or when the context
 * lacks an `images` map at all (callers fall back to the regular
 * shape emit).
 */
function tryEmitImageFill(node: FigNode, ctx: EmitContext): SwiftView | undefined {
  const images = ctx.images;
  if (!images) {
    return undefined;
  }
  const paint = firstVisibleImagePaint(node.fillPaints);
  if (!paint) {
    return undefined;
  }
  // Only take the IMAGE-fill emit path when the image is the topmost
  // visible paint; if a SOLID/GRADIENT paints on top of it, that
  // upper paint is what the consumer sees and the regular shape-leaf
  // path (which puts the image into an `.background(<shape>().fill(...))`
  // overlay via `paintToExpr`) is the right choice. Without this guard
  // an IMAGE underneath a SOLID would replace the visible SOLID with
  // the (clipped) image.
  const visible = (node.fillPaints ?? []).filter((p) => p.visible !== false);
  const topVisible = visible.length > 0 ? visible[visible.length - 1] : undefined;
  if (topVisible?.type !== "IMAGE") {
    return undefined;
  }
  const ref = resolveImageRef(paint);
  if (!ref) {
    return undefined;
  }
  const image = images.get(ref);
  if (!image) {
    return undefined;
  }
  // Pick between bundle-resource and inline-base64 emit per
  // EmitContext (default: bundle). The CLI uses `bundle` so the
  // emitted source stays small; the visual-roundtrip spec harness
  // uses `inline` because it compiles a single .swift file with
  // `swift CLI` and has no `Bundle.module` available.
  const expr = pickImageExpr(ctx.imageEmbedding ?? "bundle", image, ref);
  const shape = contentModeFor(paint.scaleMode ?? paint.imageScaleMode);
  const mods: Modifier[] = [];
  if (shape.resizing === "tile") {
    // SwiftUI's tiling resizable mode: `Image(...).resizable(resizingMode: .tile)`
    // repeats the source bitmap at native pixels across the frame.
    mods.push({
      name: "resizable",
      args: [{ name: "resizingMode", value: { kind: "member", value: "tile" } }],
    });
  } else {
    mods.push({ name: "resizable", args: [] });
  }
  if (shape.aspect !== "none") {
    mods.push({
      name: "aspectRatio",
      args: [{ name: "contentMode", value: { kind: "member", value: shape.aspect } }],
    });
  }
  // Per-image opacity (Figma's paint-level opacity on the IMAGE
  // paint). Applied directly to the Image view so layers under it
  // composite correctly through the alpha channel.
  if (typeof paint.opacity === "number" && paint.opacity !== 1) {
    mods.push({
      name: "opacity",
      args: [{ value: { kind: "number", value: paint.opacity } }],
    });
  }
  // Frame the image to the node's authored size before clipping
  // so the silhouette computes against the right outer extent.
  if (node.size) {
    mods.push({
      name: "frame",
      args: [
        { name: "width", value: { kind: "number", value: node.size.x } },
        { name: "height", value: { kind: "number", value: node.size.y } },
        { name: "alignment", value: { kind: "member", value: "topLeading" } },
      ],
    });
  }
  // If the IMAGE paint sits on top of underlying paints (e.g. a
  // SOLID below an IMAGE in the stack), layer those paints behind
  // the image using `.background(<shape>().fill(<color/gradient>))`
  // overlays. Figma renders paints back-to-front in array order, so
  // any paint that appears earlier than the IMAGE goes BEHIND it.
  const underPaints = collectUnderPaintsFor(node, paint);
  for (const layer of underPaints) {
    mods.push(layer);
  }
  // Clip to the shape silhouette (Rectangle / RoundedRectangle / Ellipse)
  // so corner radius and ellipse silhouettes survive. The clip MUST
  // come AFTER the under-paint backgrounds so they're also clipped.
  const silhouette = shapeExprFor(node);
  mods.push({
    name: "clipShape",
    args: [{ value: silhouette }],
  });
  // Stroke the silhouette as an overlay AFTER the clip so the stroke
  // paints on top of the clipped image (matching the shape-leaf order
  // for the regular .fill path). Skipped when the node has no stroke.
  const strokeOverlay = strokeOverlayModifier(node);
  if (strokeOverlay) {
    mods.push(strokeOverlay);
  }
  // Shadows / blur / opacity / rotation paint AFTER clipping in the
  // shape-leaf chain (`shapeModifiers`). The image-fill leaf needs
  // the same chain so a `RoundedRectangle` filled by a tiled image
  // and shadowed in Figma renders with the same drop-shadow
  // silhouette in SwiftUI — without these modifiers the emitted
  // file would silently drop the node-level shadow / blur, which is
  // what produced the ~30% visual diff on `image-fill-shadow`.
  for (const shadow of shadowModifiers(node)) {
    mods.push(shadow);
  }
  const blur = blurModifier(node);
  if (blur) {
    mods.push(blur);
  }
  const opacity = opacityModifier(node);
  if (opacity) {
    mods.push(opacity);
  }
  const rotation = rotationModifier(node);
  if (rotation) {
    mods.push(rotation);
  }
  return { kind: "leaf", expr, modifiers: mods };
}

function collectUnderPaintsFor(node: FigNode, top: FigImagePaint): readonly Modifier[] {
  const paints = node.fillPaints;
  if (!paints || paints.length === 0) {
    return [];
  }
  // Find the topmost IMAGE paint (the one chosen by
  // firstVisibleImagePaint). Everything BEFORE it in the array is
  // an under-paint. Walk those in reverse-array order so the
  // SwiftUI `.background` chain stacks each new background BEHIND
  // the existing content (mirroring what
  // extraFillBackgroundModifiers does for solid/gradient stacks).
  const topIndex = paints.indexOf(top);
  if (topIndex <= 0) {
    return [];
  }
  const out: Modifier[] = [];
  for (let i = topIndex - 1; i >= 0; i -= 1) {
    const p = paints[i];
    if (!p || p.visible === false) {
      continue;
    }
    const expr = paintToBackgroundExpr(p, node);
    if (!expr) {
      continue;
    }
    const bgShape = shapeExprFor(node);
    const bgView = leaf(bgShape, [modifier("fill", [{ value: expr }])]);
    out.push(modifier("background", [{ value: { kind: "view", view: bgView } }]));
  }
  return out;
}

function paintToBackgroundExpr(
  paint: NonNullable<FigNode["fillPaints"]>[number],
  node: FigNode,
): SwiftExpr | undefined {
  if (paint.type === "SOLID") {
    return solidPaintToColorImported(paint);
  }
  if (
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND"
  ) {
    const size = node.size ? { width: node.size.x, height: node.size.y } : undefined;
    return gradientExprImported(paint, size);
  }
  return undefined;
}

function emitShapeLeaf(node: FigNode, ctx: EmitContext): SwiftView {
  // IMAGE fills replace the shape primitive entirely with an
  // `Image(...).resizable().aspectRatio(...).clipShape(<silhouette>)`
  // composition — SwiftUI's `.fill(...)` doesn't accept `Image`, so
  // the cleanest realisation is to paint the image directly and
  // clip it to the shape silhouette.
  const imageView = tryEmitImageFill(node, ctx);
  if (imageView) {
    return imageView;
  }
  const shapeExpr = shapeExprFor(node);
  const mods = shapeModifiers(node);
  const hasFill = mods.some((m) => m.name === "fill");
  const hasStrokeOverlay = mods.some((m) => m.name === "overlay");
  if (!hasFill && !hasStrokeOverlay) {
    throw new Error(
      `fig-to-swiftui: ${node.type.name} node "${node.name ?? "unnamed"}" has no SOLID fill or stroke — gradients/images are not yet supported`,
    );
  }
  if (!hasFill && hasStrokeOverlay) {
    // Stroke-only shape — promote the stroke from an .overlay(...) on
    // a non-existent fill to a direct .stroke / .strokeBorder modifier
    // on the bare shape. The overlay form would still paint correctly,
    // but it leaves an invisible Rectangle() underneath that affects
    // hit-testing and clutters the source.
    const promoted = promoteStrokeOnlyShape(node, shapeExpr, mods);
    return leaf(shapeExpr, promoted);
  }
  return leaf(shapeExpr, mods);
}

/**
 * Convert the modifier list of a stroke-only shape leaf from
 * `[overlay(<shape>().strokeBorder(...))]` to `[strokeBorder(...)]`
 * directly on the shape. The overlay form was emitted by
 * `strokeOverlayModifier` because the helper is shape-agnostic; the
 * leaf path knows the underlying shape and can move the stroke onto
 * the shape itself.
 */
function promoteStrokeOnlyShape(
  node: FigNode,
  shapeExpr: ReturnType<typeof shapeExprFor>,
  mods: readonly Modifier[],
): readonly Modifier[] {
  void shapeExpr;
  void node;
  const out: Modifier[] = [];
  for (const m of mods) {
    if (m.name !== "overlay") {
      out.push(m);
      continue;
    }
    // Pull the strokeBorder / stroke modifier off the embedded view
    // and place it on the shape leaf directly.
    const inner = m.args[0]?.value;
    if (inner?.kind !== "view") {
      out.push(m);
      continue;
    }
    out.push(...inner.view.modifiers);
  }
  return out;
}

/** Render a stack-shaped container (FRAME / GROUP / SYMBOL / INSTANCE). */
/**
 * If the child has Figma's `stackChildPrimaryGrow` flag set, replace
 * the child's `.frame(width:height:alignment:)` with a grow-aware
 * variant that lets SwiftUI stretch the view along the parent's
 * primary axis. The container's HStack/VStack will then expand the
 * child to fill remaining space, matching Figma's "fill container"
 * sizing.
 *
 * Only the child's outermost frame modifier is patched (the one
 * `frameModifier` emitted from the child's own `node.size`); inner
 * frames the child may carry stay fixed.
 */
type AxisMode = "fixed" | "infinity";

function pickAxisMode(
  primaryHorizontal: boolean,
  wantsPrimaryGrow: boolean,
  wantsCounterStretch: boolean,
  axis: "horizontal" | "vertical",
): AxisMode {
  const isPrimaryAxis = primaryHorizontal === (axis === "horizontal");
  if (isPrimaryAxis && wantsPrimaryGrow) {
    return "infinity";
  }
  if (!isPrimaryAxis && wantsCounterStretch) {
    return "infinity";
  }
  return "fixed";
}

function buildMaxArg(name: "maxWidth" | "maxHeight", mode: AxisMode, fixedValue: SwiftCallArg["value"]): SwiftCallArg {
  if (mode === "infinity") {
    return { name, value: { kind: "member", value: "infinity" } };
  }
  return { name, value: fixedValue };
}

function applyGrowSizing(view: SwiftView, child: FigNode, parent: LayoutPlan): SwiftView {
  if (parent.stack !== "HStack" && parent.stack !== "VStack") {
    return view;
  }
  const grow = child.stackChildPrimaryGrow;
  const alignSelf = (child as { stackChildAlignSelf?: { name?: string } }).stackChildAlignSelf?.name;
  const wantsPrimaryGrow = !!grow && grow > 0;
  const wantsCounterStretch = alignSelf === "STRETCH";
  if (!wantsPrimaryGrow && !wantsCounterStretch) {
    return view;
  }
  // Decide which axes flex. Primary-axis grow on HStack →
  // `maxWidth: .infinity` (and on VStack → `maxHeight`). Counter-axis
  // stretch is the orthogonal direction.
  const primaryHorizontal = parent.stack === "HStack";
  const widthMode = pickAxisMode(primaryHorizontal, wantsPrimaryGrow, wantsCounterStretch, "horizontal");
  const heightMode = pickAxisMode(primaryHorizontal, wantsPrimaryGrow, wantsCounterStretch, "vertical");
  const replaced = replaceFirstFrameMod(view.modifiers, widthMode, heightMode);
  if (!replaced) {
    return view;
  }
  if (view.kind === "stack") {
    return { ...view, modifiers: replaced };
  }
  return { ...view, modifiers: replaced };
}

function replaceFirstFrameMod(
  mods: readonly Modifier[],
  widthMode: AxisMode,
  heightMode: AxisMode,
): readonly Modifier[] | undefined {
  const idx = mods.findIndex((m) => m.name === "frame" && canPromoteFrame(m));
  if (idx < 0) {
    return undefined;
  }
  const mod = mods[idx];
  if (!mod) {
    return undefined;
  }
  const widthArg = mod.args.find((a) => a.name === "width");
  const heightArg = mod.args.find((a) => a.name === "height");
  const alignmentArg = mod.args.find((a) => a.name === "alignment");
  if (!widthArg || !heightArg) {
    return undefined;
  }
  const out: SwiftCallArg[] = [
    buildMaxArg("maxWidth", widthMode, widthArg.value),
    buildMaxArg("maxHeight", heightMode, heightArg.value),
  ];
  if (alignmentArg) {
    out.push(alignmentArg);
  }
  const next = [...mods];
  next[idx] = { name: "frame", args: out };
  return next;
}

function canPromoteFrame(mod: Modifier): boolean {
  const widthArg = mod.args.find((a) => a.name === "width");
  const heightArg = mod.args.find((a) => a.name === "height");
  if (!widthArg || !heightArg) {
    return false;
  }
  return widthArg.value.kind === "number" && heightArg.value.kind === "number";
}

/** True when the frame uses Figma's GRID stack mode. */
function isGridNode(node: FigNode): boolean {
  const mode = (node as { stackMode?: { name?: string } | string }).stackMode;
  const name = typeof mode === "string" ? mode : mode?.name;
  return name === "GRID";
}

/**
 * Emit a Figma GRID frame as a VStack of HStacks. SwiftUI's
 * `LazyVGrid` would be more idiomatic but its sizing under
 * `ImageRenderer` is finicky for fixed-content fixtures; the
 * VStack-of-HStacks form keeps layout deterministic and the
 * column/row gap fields map directly onto stack `spacing`.
 *
 * The number of columns is read from `node.gridColumns.entries.length`
 * (or 1 when missing); rows fall out as `ceil(childCount / columns)`.
 * Column gap → HStack spacing, row gap → VStack spacing. Padding,
 * background, stroke, etc. inherit through `containerModifiers`.
 */
function emitGridContainer(node: FigNode, ctx: EmitContext): SwiftView {
  const plan = planLayout(node);
  const columns = readGridColumnCount(node);
  // Figma stores grid gaps in either of two channels depending on
  // the file generation: `gridRowGap`/`gridColumnGap` (newer) or
  // `stackSpacing`/`stackCounterSpacing` (older, generic stack
  // fields reused for grids). We accept both, preferring the
  // grid-named channel when set.
  const colGap =
    (node as { gridColumnGap?: number }).gridColumnGap ??
    (node.stackSpacing ?? 0);
  const rowGap =
    (node as { gridRowGap?: number }).gridRowGap ??
    (node as { stackCounterSpacing?: number }).stackCounterSpacing ??
    0;
  const children = renderedChildren(node, ctx);
  const childViews: SwiftView[] = children.map((c) => emitNode(c, ctx));
  const rows: SwiftView[] = [];
  for (let i = 0; i < childViews.length; i += columns) {
    const rowChildren = childViews.slice(i, i + columns);
    rows.push(
      stack(
        {
          stack: "HStack",
          alignment: "top",
          spacing: colGap,
        },
        rowChildren,
      ),
    );
  }
  const mods = containerModifiers(node, plan, children.length);
  return stack(
    {
      stack: "VStack",
      alignment: "leading",
      spacing: rowGap,
      modifiers: mods,
    },
    rows,
  );
}

function readGridColumnCount(node: FigNode): number {
  const cols = (node as { gridColumns?: { entries?: readonly unknown[] } }).gridColumns;
  const entries = cols?.entries;
  if (Array.isArray(entries) && entries.length > 0) {
    return entries.length;
  }
  return 1;
}

/**
 * True when the frame is a wrapping HStack/VStack (Figma's
 * "Wrap" autolayout option).
 */
function isWrapNode(node: FigNode): boolean {
  const wrap = (node as { stackWrap?: { name?: string } | string }).stackWrap;
  const name = typeof wrap === "string" ? wrap : wrap?.name;
  return name === "WRAP";
}

/**
 * Emit a Figma WRAP-mode autolayout frame. We pre-compute the row
 * breaks based on the children's authored widths + the parent's
 * cross-axis content width, then emit a VStack-of-HStacks (or the
 * symmetric pair for a vertical-wrap frame). Spacing in the primary
 * direction maps to `HStack(spacing:)`; spacing on the cross axis
 * maps to `VStack(spacing:)` (Figma's `stackCounterSpacing`).
 *
 * SwiftUI's `Layout` protocol could realise true wrap behaviour at
 * runtime, but for fixed-content fixtures the precomputed chunking
 * matches Figma's render exactly and avoids a custom layout shim.
 */
function chunkWrapRows(
  children: readonly FigNode[],
  horizontal: boolean,
  stackSpacing: number,
  contentExtent: number,
): readonly FigNode[][] {
  // Walk children left-to-right (or top-to-bottom for a vertical
  // wrap), accumulating each row's used extent until the next child
  // wouldn't fit; the row breaks there. Mirrors the renderer's
  // pre-layout row computation. Mutable accumulators are scoped
  // inside this helper so the caller stays free of `let`.
  const rows: FigNode[][] = [];
  const acc = { current: [] as FigNode[], used: 0 };
  for (const child of children) {
    const childExtent = horizontal ? child.size?.x ?? 0 : child.size?.y ?? 0;
    const needed = acc.current.length === 0 ? childExtent : acc.used + stackSpacing + childExtent;
    if (acc.current.length > 0 && needed > contentExtent + 1e-3) {
      rows.push(acc.current);
      acc.current = [child];
      acc.used = childExtent;
      continue;
    }
    acc.current.push(child);
    acc.used = needed;
  }
  if (acc.current.length > 0) {
    rows.push(acc.current);
  }
  return rows;
}

function wrapContentExtent(
  node: FigNode,
  horizontal: boolean,
  padL: number,
  padR: number,
  padT: number,
  padB: number,
): number {
  if (horizontal) {
    return Math.max(0, (node.size?.x ?? 0) - padL - padR);
  }
  return Math.max(0, (node.size?.y ?? 0) - padT - padB);
}

function emitWrapContainer(node: FigNode, ctx: EmitContext): SwiftView {
  const plan = planLayout(node);
  const horizontal = plan.stack === "HStack" || plan.stack === "ZStack";
  const stackSpacing = (node as { stackSpacing?: number }).stackSpacing ?? 0;
  const counterSpacing = (node as { stackCounterSpacing?: number }).stackCounterSpacing ?? 0;
  const padL = plan.padding.left;
  const padR = plan.padding.right;
  const padT = plan.padding.top;
  const padB = plan.padding.bottom;
  const contentExtent = wrapContentExtent(node, horizontal, padL, padR, padT, padB);
  const children = renderedChildren(node, ctx);
  const rows = chunkWrapRows(children, horizontal, stackSpacing, contentExtent);
  const rowViews = rows.map((row) => {
    const items = row.map((c) => emitNode(c, ctx));
    return stack(
      {
        stack: horizontal ? "HStack" : "VStack",
        alignment: horizontal ? "top" : "leading",
        spacing: stackSpacing,
      },
      items,
    );
  });
  const mods = containerModifiers(node, plan, children.length);
  return stack(
    {
      stack: horizontal ? "VStack" : "HStack",
      alignment: horizontal ? "leading" : "top",
      spacing: counterSpacing,
      modifiers: mods,
    },
    rowViews,
  );
}

function orderForZReverse(
  children: readonly FigNode[],
  reverseZ: boolean,
  stackKind: StackKind,
): readonly FigNode[] {
  if (!reverseZ || stackKind !== "ZStack") {
    return children;
  }
  return [...children].reverse();
}

function pickStackSpacing(plan: LayoutPlan): number | undefined {
  if (plan.primary === "space-between" && plan.spacing !== undefined) {
    return 0;
  }
  return plan.spacing;
}

function applyZIndexForReverse(
  view: SwiftView,
  reverseZ: boolean,
  stackKind: StackKind,
  total: number,
  idx: number,
): SwiftView {
  if (!reverseZ || stackKind === "ZStack") {
    return view;
  }
  return withZIndex(view, total - idx);
}

function withZIndex(view: SwiftView, z: number): SwiftView {
  const mod: Modifier = {
    name: "zIndex",
    args: [{ value: { kind: "number", value: z } }],
  };
  if (view.kind === "stack") {
    return { ...view, modifiers: [...view.modifiers, mod] };
  }
  return { ...view, modifiers: [...view.modifiers, mod] };
}

/**
 * Detect Figma's "first-child-as-mask" pattern: a non-autolayout
 * frame whose first child is a SOLID-filled shape (RECTANGLE /
 * ROUNDED_RECTANGLE / ELLIPSE) sized to the parent, with one or
 * more subsequent children that are content (not necessarily
 * sized to the parent). The first child's silhouette acts as an
 * alpha mask: only the area where the mask paints opaquely shows
 * the content beneath.
 *
 * Authored without the `node.mask = true` flag — the fixture-
 * author's convention is positional. Returns `undefined` when the
 * pattern doesn't match so the regular container path runs.
 *
 * Emit: `ZStack(alignment: .topLeading) { content* }.mask(<first-child>).frame(...)`
 */
function tryEmitMaskContainer(
  node: FigNode,
  children: readonly FigNode[],
  ctx: EmitContext,
): SwiftView | undefined {
  // Only non-autolayout frames are candidates — autolayout
  // children flow rather than overlap, so a "first as mask"
  // interpretation would conflict.
  if (node.stackMode?.name === "HORIZONTAL" || node.stackMode?.name === "VERTICAL") {
    return undefined;
  }
  if (children.length < 2) {
    return undefined;
  }
  const visible = children.filter(isRendered);
  if (visible.length < 2) {
    return undefined;
  }
  const first = visible[0];
  if (!first || !isPlausibleMaskShape(first, node)) {
    return undefined;
  }
  // Only treat first-as-mask when at least one subsequent child
  // OVERFLOWS the mask bounds. When all content fits inside the
  // mask shape's bounding box, masking would be a no-op visually
  // — so skip emitting the mask and let the regular container
  // path render. (This matches the WebGL renderer's empirical
  // behaviour on the paint-advanced/mask-basic vs mask-rounded
  // fixtures: only the rounded case has overflowing content.)
  if (!hasOverflowingChild(visible.slice(1), first)) {
    return undefined;
  }
  // Build the mask shape view — bare silhouette + a SOLID white
  // fill (the alpha channel is what masks).
  const maskExpr = shapeExprFor(first);
  const maskView = leaf(maskExpr, [
    modifier("fill", [{ value: { kind: "ident", value: "Color.white" } }]),
    modifier("frame", [
      namedArg("width", num(first.size?.x ?? node.size?.x ?? 0)),
      namedArg("height", num(first.size?.y ?? node.size?.y ?? 0)),
      namedArg("alignment", member("topLeading")),
    ]),
    modifier("offset", [
      namedArg("x", num(first.transform?.m02 ?? 0)),
      namedArg("y", num(first.transform?.m12 ?? 0)),
    ]),
  ]);
  // Build the content ZStack from the rest of the children.
  const contentChildren = visible.slice(1);
  const plan = planLayout(node);
  const childViews = contentChildren.map((c) => {
    const cv = emitNode(c, ctx);
    return withPlacement(cv, placementFor(c, plan));
  });
  // Outer container modifiers without the .mask — we add it
  // explicitly between background and the rest of the chain so it
  // applies to the painted content area, not to the framed
  // bounds afterwards.
  const containerMods = containerModifiers(node, plan, childViews.length);
  const stackView = stack(
    {
      stack: "ZStack",
      alignment: "topLeading",
      modifiers: [
        ...containerMods,
        modifier("mask", [{ value: { kind: "view", view: maskView } }]),
      ],
    },
    childViews,
  );
  return stackView;
}

function hasOverflowingChild(content: readonly FigNode[], mask: FigNode): boolean {
  if (!mask.size) {
    return false;
  }
  const mw = mask.size.x;
  const mh = mask.size.y;
  const mx = mask.transform?.m02 ?? 0;
  const my = mask.transform?.m12 ?? 0;
  const tol = 1.0;
  for (const c of content) {
    if (!c.size) {
      continue;
    }
    const cx = c.transform?.m02 ?? 0;
    const cy = c.transform?.m12 ?? 0;
    if (cx + tol < mx) {
      return true;
    }
    if (cy + tol < my) {
      return true;
    }
    if (cx + c.size.x > mx + mw + tol) {
      return true;
    }
    if (cy + c.size.y > my + mh + tol) {
      return true;
    }
  }
  return false;
}

function isPlausibleMaskShape(child: FigNode, parent: FigNode): boolean {
  const t = child.type.name;
  if (t !== "RECTANGLE" && t !== "ROUNDED_RECTANGLE" && t !== "ELLIPSE") {
    return false;
  }
  if (!parent.size || !child.size) {
    return false;
  }
  // Mask candidate must have a SOLID fill — gradients/images on
  // the mask shape would carry their own alpha pattern that the
  // current detector doesn't reason about.
  const paints = child.fillPaints;
  if (!paints || paints.length === 0) {
    return false;
  }
  const firstSolid = paints.find((p) => p.visible !== false && p.type === "SOLID");
  if (!firstSolid) {
    return false;
  }
  // Must fully cover the parent's content area (within 1px tolerance).
  const tol = 1.0;
  const childX = child.transform?.m02 ?? 0;
  const childY = child.transform?.m12 ?? 0;
  if (Math.abs(childX) > tol || Math.abs(childY) > tol) {
    return false;
  }
  if (Math.abs(child.size.x - parent.size.x) > tol) {
    return false;
  }
  if (Math.abs(child.size.y - parent.size.y) > tol) {
    return false;
  }
  return true;
}

function emitContainer(rawNode: FigNode, ctx: EmitContext): SwiftView {
  // Expand INSTANCE → SYMBOL so the merged node (carrying the
  // SYMBOL's fillPaints, strokePaints, size, etc.) drives modifier
  // resolution, while children come from the SYMBOL's tree (with
  // INSTANCE-level overrides folded in by the canonical resolver).
  const { node, children: resolvedChildren } = resolveInstanceFor(rawNode, ctx);
  if (isGridNode(node)) {
    return emitGridContainer(node, ctx);
  }
  if (isWrapNode(node)) {
    return emitWrapContainer(node, ctx);
  }
  const masked = tryEmitMaskContainer(node, resolvedChildren, ctx);
  if (masked) {
    return masked;
  }
  const plan = planLayout(node);
  // Figma's `stackReverseZIndex` reverses paint order: the
  // first-authored child paints ON TOP (instead of the last). For
  // HStack / VStack we cannot just reverse the children array —
  // that would also reverse layout flow direction. Instead we apply
  // `.zIndex(N - i)` so the first-authored child sits at z=N and
  // paints on top, while the layout order remains intact.
  // For ZStack we *can* reverse the array because flow direction
  // doesn't apply (it's pure absolute positioning).
  const children = resolvedChildren.filter(isRendered);
  const reverseZ = (node as { stackReverseZIndex?: boolean }).stackReverseZIndex === true;
  // ABSOLUTE-positioned children in an autolayout frame don't
  // participate in the HStack/VStack flow — they overlay at their
  // own coordinates. Split them out so the autolayout stack sees
  // only the flow children, and we wrap the whole composition in a
  // ZStack at the outer level when absolute children exist.
  const flowChildren: FigNode[] = [];
  const absoluteChildren: FigNode[] = [];
  if (plan.stack === "HStack" || plan.stack === "VStack") {
    for (const c of children) {
      if (c.stackPositioning?.name === "ABSOLUTE") {
        absoluteChildren.push(c);
      } else {
        flowChildren.push(c);
      }
    }
  } else {
    flowChildren.push(...children);
  }
  const orderedChildren = orderForZReverse(flowChildren, reverseZ, plan.stack);
  const childViews: SwiftView[] = [];
  orderedChildren.forEach((child, idx) => {
    const childView = emitNode(child, ctx);
    const placed = withPlacement(childView, placementFor(child, plan));
    const grown = applyGrowSizing(placed, child, plan);
    const zd = applyZIndexForReverse(grown, reverseZ, plan.stack, orderedChildren.length, idx);
    childViews.push(zd);
  });
  const distributed = applyPrimaryDistribution(plan, childViews);
  const mods = containerModifiers(node, plan, childViews.length);
  // SPACE_BETWEEN distributes leftover space, ignoring authored
  // `stackSpacing` — and SwiftUI's HStack(spacing: N) adds N
  // between every adjacent pair including rect↔Spacer pairs,
  // which over-allocates with Spacers in the way. Reset spacing
  // to 0 only in SPACE_BETWEEN. CENTER / MAX use frame alignment
  // and keep their authored spacing.
  const stackSpacing = pickStackSpacing(plan);
  if (absoluteChildren.length === 0) {
    return stack(
      {
        stack: plan.stack,
        alignment: plan.alignment,
        spacing: stackSpacing,
        modifiers: mods,
      },
      distributed,
    );
  }
  // Wrap the autolayout stack PLUS the absolute children in an
  // outer ZStack. The autolayout stack gets *only* the padding
  // (so its flow-children get inset correctly); the absolute
  // children sit at the ZStack's outer origin and use their
  // Figma-authored frame coords directly via `.offset(...)`.
  // The outer ZStack carries the rest of the modifier chain
  // (frame, background, stroke, shadow, etc.).
  const innerPaddingMods = mods.filter((m) => m.name === "padding");
  const outerMods = mods.filter((m) => m.name !== "padding");
  const innerStackView = stack(
    {
      stack: plan.stack,
      alignment: plan.alignment,
      spacing: stackSpacing,
      modifiers: innerPaddingMods,
    },
    distributed,
  );
  const absoluteViews = absoluteChildren.map((c) => {
    const cv = emitNode(c, ctx);
    return withPlacement(cv, {
      mode: "absolute",
      x: c.transform?.m02 ?? 0,
      y: c.transform?.m12 ?? 0,
    });
  });
  return stack(
    {
      stack: "ZStack",
      alignment: "topLeading",
      modifiers: outerMods,
    },
    [innerStackView, ...absoluteViews],
  );
}

const LINE_TYPE = "LINE";
const GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "VECTOR",
  "STAR",
  "REGULAR_POLYGON",
]);
// BOOLEAN_OPERATION nodes carry children whose paths Figma combines
// at render time via a real boolean path engine. SwiftUI has no
// equivalent native primitive; emitting the children inside a ZStack
// produces a structurally-similar view (the children render in the
// right places with the right paints) but doesn't perform the
// union/subtract/intersect/exclude itself. The visual diff against
// Figma's renderer reflects that gap honestly. A future iteration
// could plumb the renderer's `evaluateBooleanPathResult` here and
// emit a single composite `Path { … }` with the boolean output.
const BOOLEAN_OPERATION_TYPE = "BOOLEAN_OPERATION";

/**
 * Build a `Image("<slug>", bundle: .module).resizable().frame(...)`
 * leaf for a node whose subtree the CLI rasterised to a PNG bundle
 * resource. The resource lives at `<out>/Resources/<slug>.png` and
 * is loaded via SwiftUI's bundle-aware Image initialiser; the
 * Image's intrinsic size is whatever the PNG carries (we framed the
 * harness render to the node's authored width × height), so the
 * `.frame(width: w, height: h, alignment: .topLeading)` modifier
 * keeps the layout coordinates aligned with what the original
 * SwiftUI subtree would have produced.
 */
function emitRasterizedImageLeaf(node: FigNode, slug: string): SwiftView {
  const w = node.size?.x ?? 0;
  const h = node.size?.y ?? 0;
  const expr = call("Image", [
    arg(str(slug)),
    namedArg("bundle", member("module")),
  ]);
  const mods: Modifier[] = [
    modifier("resizable", []),
    modifier("frame", [
      namedArg("width", num(w)),
      namedArg("height", num(h)),
      namedArg("alignment", member("topLeading")),
    ]),
  ];
  return leaf(expr, mods);
}

/**
 * Look up the rasterised resource slug for a node, if any. Returns
 * `undefined` when the node hasn't been rasterised. Encodes the
 * `(sessionID, localID)` key inline so the lookup falls through
 * cheaply for the common no-rasterisation case.
 */
function lookupRasterizedSlug(node: FigNode, ctx: EmitContext): string | undefined {
  const map = ctx.rasterizedSubtrees;
  if (!map || !node.guid) {
    return undefined;
  }
  return map.get(`${node.guid.sessionID}:${node.guid.localID}`);
}

/** Top-level entry — render any node into a SwiftView. */
export function emitNode(node: FigNode, ctx: EmitContext = {}): SwiftView {
  const slug = lookupRasterizedSlug(node, ctx);
  if (slug !== undefined) {
    return emitRasterizedImageLeaf(node, slug);
  }
  const typeName = getNodeType(node);
  if (typeName === TEXT_TYPE) {
    return emitTextNode(node);
  }
  if (typeName === ELLIPSE_TYPE && isEllipseArcOrDonut(node)) {
    return emitEllipseArcOrDonut(node);
  }
  if (
    typeName === RECTANGLE_TYPE ||
    typeName === ROUNDED_RECTANGLE_TYPE ||
    typeName === ELLIPSE_TYPE
  ) {
    return emitShapeLeaf(node, ctx);
  }
  if (typeName === LINE_TYPE) {
    return emitLineLeaf(node);
  }
  if (GEOMETRY_TYPES.has(typeName)) {
    return emitGeometryLeaf(node, ctx);
  }
  if (typeName === BOOLEAN_OPERATION_TYPE) {
    // Try the canonical boolean composition path: child geometry →
    // d-strings → path-bool engine → resulting d-strings → SwiftUI
    // `Path`. Falls back to the ZStack-of-children container emit
    // when blobs are unavailable or the engine rejects the input.
    const composed = tryComposeBooleanLeaf(node, ctx.blobs);
    if (composed) {
      return composed;
    }
    return emitContainer(node, ctx);
  }
  if (FRAME_LIKE_TYPES.has(typeName)) {
    return emitContainer(node, ctx);
  }
  throw new Error(
    `fig-to-swiftui: unsupported node type "${typeName}" (node "${node.name ?? "unnamed"}")`,
  );
}

/**
 * Render a top-level frame as a complete SwiftUI body. The root
 * suppresses the `.offset(...)` placement that `withPlacement`
 * applies to nested children — a top-level frame is not positioned
 * inside another container.
 */
export function emitRootFrame(node: FigNode, ctx: EmitContext = {}): SwiftView {
  return emitNode(node, ctx);
}
