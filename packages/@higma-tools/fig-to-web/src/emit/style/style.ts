/**
 * @file Convert FigNode visual properties into a CSS-in-JS style record.
 *
 * The emitted style depends on three pieces of context:
 *
 *   1. The node itself (paints, strokes, radii, text properties, ...).
 *   2. Whether the node is the *root* of a frame/component (in which
 *      case it is laid out as `position: relative`) or a descendant.
 *   3. The *parent's* layout decision — flex (auto-layout) or static.
 *      A descendant of a flex parent flows naturally and must NOT
 *      carry `position: absolute` + `left/top`; a descendant of a
 *      static parent is positioned absolutely from the FigMatrix.
 *
 * Visual fidelity goals (kept on parity with Figma's rendering):
 *
 *   - Multi-paint stacks composed in Figma's bottom-first ordering.
 *   - Linear gradients with the angle Figma actually authored
 *     (derived from `gradientHandlePositions` or the Kiwi `transform`).
 *   - Image fills extracted as URL references (writer-side detail
 *     belongs to `images.ts`).
 *   - Stroke alignment honoured: INSIDE → `box-shadow inset`
 *     (CSS `border` is INSIDE-aligned anyway), OUTSIDE → `outline`,
 *     CENTER → CSS `border` (the default).
 *   - Stroke dashes via `border-style: dashed` when uniform, falling
 *     back to a `box-shadow` outline when authored as `strokeDashes`
 *     with an arbitrary pattern.
 *   - `mix-blend-mode` for non-PASS_THROUGH blend modes.
 *   - LAYER_BLUR / FOREGROUND_BLUR → `filter: blur(...)`.
 *   - BACKGROUND_BLUR → `backdrop-filter: blur(...)`.
 */
import type {
  FigEffect,
  FigEffectType,
  FigNode,
  FigStrokeAlign,
  FigStrokeWeight,
  FigValueWithUnits,
} from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { TokenIndex } from "../../tokens";
import { effectsToBoxShadow } from "../../tokens";
import type { ImageResolver } from "./paint";
import { paintsForText, paintsToBackgroundStyle } from "./paint";
import type { InferenceResult, InferredInset, InferredLayout } from "../layout/infer-layout";
import { isVectorOnlyContainer } from "../svg/svg";
import { computeRuleGeometry } from "./rule";

const ROOT_FRAME_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "SYMBOL",
  "GROUP",
  // INSTANCE wrappers can carry their own auto-layout (`stackMode` /
  // `stackPrimaryAlignItems` / `stackCounterAlignItems`) that *was not*
  // set on the underlying SYMBOL — Figma's pill chip is the canonical
  // example: the SYMBOL has fixed-position children, the INSTANCE
  // re-applies a `VERTICAL CENTER CENTER` stack to recentre the
  // resolved content. Treating INSTANCE as an authoring-layout root
  // emits a flex container at the page-level wrapper so the
  // `<Component .../>` reference lands centred instead of pinned to
  // top-left.
  "INSTANCE",
]);

const VECTOR_SHAPED_TYPES: ReadonlySet<string> = new Set([
  "VECTOR",
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "BOOLEAN_OPERATION",
]);

const ELLIPSE_TYPE = "ELLIPSE";

/**
 * Should this node clip overflowing children?
 *
 * The renderer's `geometry/interpret.ts :: resolveClipsContent`
 * settles three signals in priority order, and we mirror that
 * exact precedence so a `<div>` we emit clips iff Figma's SVG
 * renderer also clipped:
 *
 *   1. `node.clipsContent` — when Figma's tree-builder lifted the
 *      raw `frameMaskDisabled` into the typed domain field, this is
 *      the answer.
 *   2. `node.frameMaskDisabled` (raw Kiwi) — inverted semantics:
 *      `frameMaskDisabled: true` means "do not clip", `false` means
 *      "clip". Real `.fig` exports often carry this field instead
 *      of (or in addition to) `clipsContent`, so missing this fork
 *      makes us silently fall through to type defaults and clip
 *      content the original design left visible. INSTANCE wrappers
 *      with `frameMaskDisabled: true` are the canonical case —
 *      clipping there cuts off the SYMBOL's natural-size content
 *      that should overflow into the layout.
 *   3. Type default — FRAME / COMPONENT / COMPONENT_SET clip
 *      unless the design opted out. GROUP / SECTION / INSTANCE
 *      / shape leaves do not.
 */
function shouldClipContent(node: FigNode): boolean {
  const wantsClip = resolveClipFlag(node);
  if (!wantsClip) {
    return false;
  }
  // Mirror the SVG renderer's degenerate-clip special case
  // (`scene-graph/render-tree/resolve.ts`): when an authored clip
  // would have zero or negative area, Figma's exporter omits the
  // `<clipPath>` so children that paint outside the rect (a LINE's
  // 2px stroke straddling y=0 of a 316×0 wrapper, a 0.01px-tall
  // collapsed Home_2 row whose 30+px children should still hide)
  // continue to render. Threshold matches the renderer exactly:
  // `<= 0` is the degenerate trigger; positive but tiny dimensions
  // (Home_2's 0.01px row) keep clipping.
  if (node.size && (node.size.x <= 0 || node.size.y <= 0)) {
    return false;
  }
  return true;
}

function resolveClipFlag(node: FigNode): boolean {
  if (node.clipsContent === true) {
    return true;
  }
  if (node.clipsContent === false) {
    return false;
  }
  if (typeof node.frameMaskDisabled === "boolean") {
    return !node.frameMaskDisabled;
  }
  return CLIP_BY_DEFAULT_TYPES.has(node.type.name);
}

const CLIP_BY_DEFAULT_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
]);
// INSTANCE is deliberately *not* included: Figma scales an
// INSTANCE's resolved content to fit its bounding box, while we
// render the SYMBOL at its authored natural size. Clipping the
// wrapper would cut off legitimate content (the YouTube logo at a
// 90×20 INSTANCE that holds a 127×28 symbol image) instead of
// scaling it. Leaving INSTANCE wrappers as `overflow: visible`
// matches the previous behaviour until a proper scale-to-fit is
// in place.

/**
 * True when an ELLIPSE node carries Figma `arcData` describing a
 * non-trivial partial sweep or donut. Full-circle `arcData` (no-op
 * arc) is treated as a plain ellipse so IMAGE / GRADIENT fills
 * survive via `border-radius: 50%` + `background-image`. SVG
 * `<path fill="..."`> cannot host a CSS image background.
 */
function hasEllipseArc(node: FigNode): boolean {
  const arc = (node as { readonly arcData?: { readonly startingAngle: number; readonly endingAngle: number; readonly innerRadius: number } }).arcData;
  if (!arc) {
    return false;
  }
  if (arc.innerRadius && arc.innerRadius > 0) {
    return true;
  }
  const sweep = Math.abs(arc.endingAngle - arc.startingAngle);
  return Math.abs(sweep - 2 * Math.PI) >= 1e-3;
}

/** Layout regime applied at this node's *root* level. */
export type RootMode = "page-root" | "component-root";

/** Layout regime the parent imposes on this node. */
export type ParentLayout = "flex-row" | "flex-column" | "static" | "none";

/** Per-child sizing along a flex axis, mirroring Figma's stack sizing enum. */
type AxisSizing = "fixed" | "fill" | "hug";

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatPx(n: number): string {
  if (Number.isInteger(n)) {
    return `${n}px`;
  }
  return `${Math.round(n * 100) / 100}px`;
}

function strokeWidth(weight: FigStrokeWeight | undefined): number | undefined {
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    return weight;
  }
  return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

function radiusValue(node: FigNode, index: TokenIndex): string | undefined {
  if (node.rectangleCornerRadii && node.rectangleCornerRadii.length === 4) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    const validRadii =
      typeof tl === "number" && typeof tr === "number"
      && typeof br === "number" && typeof bl === "number";
    if (validRadii) {
      return `${formatPx(tl)} ${formatPx(tr)} ${formatPx(br)} ${formatPx(bl)}`;
    }
  }
  // Real Figma .fig files store per-corner radii on individual fields,
  // not the array. Fall back to those before checking the uniform
  // `cornerRadius` (which represents the case where every corner shares
  // a value). See `decoration.ts > perCornerRadiusCss` for parity with
  // the decoration emit path.
  const tl = node.rectangleTopLeftCornerRadius;
  const tr = node.rectangleTopRightCornerRadius;
  const br = node.rectangleBottomRightCornerRadius;
  const bl = node.rectangleBottomLeftCornerRadius;
  if (tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined) {
    const tlN = tl ?? 0;
    const trN = tr ?? 0;
    const brN = br ?? 0;
    const blN = bl ?? 0;
    if (tlN > 0 || trN > 0 || brN > 0 || blN > 0) {
      return `${formatPx(tlN)} ${formatPx(trN)} ${formatPx(brN)} ${formatPx(blN)}`;
    }
  }
  const r = typeof node.cornerRadius === "number" ? node.cornerRadius : undefined;
  if (r === undefined) {
    return undefined;
  }
  const tokenId = index.radiusIdFor(r);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  return formatPx(r);
}

function spacingValue(value: number, index: TokenIndex): string {
  const tokenId = index.spacingIdFor(value);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  return formatPx(value);
}

function shadowValue(node: FigNode, index: TokenIndex): string | undefined {
  const tokenId = index.shadowIdFor(node.effects);
  if (tokenId) {
    return `var(--${tokenId})`;
  }
  return effectsToBoxShadow(node.effects);
}

function lineHeightCss(value: FigValueWithUnits | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  switch (value.units.name) {
    case "PIXELS":
      return `${value.value}px`;
    case "PERCENT":
      return `${value.value}%`;
    case "RAW":
      return `${value.value}`;
    case "AUTO":
      return "normal";
  }
  throw new Error(`style: unknown lineHeight units "${value.units.name}"`);
}

function letterSpacingCss(value: FigValueWithUnits | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.value === 0) {
    return undefined;
  }
  switch (value.units.name) {
    case "PIXELS":
      return `${value.value}px`;
    case "PERCENT":
      return `${value.value / 100}em`;
    case "RAW":
      return `${value.value}em`;
    case "AUTO":
      return undefined;
  }
  throw new Error(`style: unknown letterSpacing units "${value.units.name}"`);
}

function textAlignCss(name: string | undefined): string | undefined {
  switch (name) {
    case "LEFT":
      return "left";
    case "RIGHT":
      return "right";
    case "CENTER":
      return "center";
    case "JUSTIFIED":
      return "justify";
    default:
      return undefined;
  }
}

/** Parent's auto-layout regime as inferred from `stackMode`. */
export function parentLayoutOf(parent: FigNode | undefined): ParentLayout {
  if (!parent) {
    return "none";
  }
  const stackMode = parent.stackMode?.name;
  if (stackMode === "VERTICAL") {
    return "flex-column";
  }
  if (stackMode === "HORIZONTAL") {
    return "flex-row";
  }
  return "static";
}

/**
 * True when the node must establish its own positioning context —
 * i.e. it has at least one direct child that will paint as
 * `position: absolute`. Other nodes can stay at the CSS default
 * (static) and avoid the cosmetic `position: relative` that idiomatic
 * web code rarely needs.
 */
export function nodeNeedsPositioningContext(
  node: FigNode,
  inferredLayoutDirection: "row" | "column" | "inset" | undefined,
): boolean {
  if (!node.children || node.children.length === 0) {
    return false;
  }
  // Vector-only containers emit as a single `<svg>` whose descendants
  // become `<path>` elements internally — no React DOM child appears
  // outside the SVG, so the container doesn't need `position:
  // relative` to anchor anything.
  if (isVectorOnlyContainer(node)) {
    return false;
  }
  const isRealFlex = node.stackMode?.name === "VERTICAL" || node.stackMode?.name === "HORIZONTAL";
  // For real or inferred flex/inset layouts, children flow — no
  // descendant of THIS node will need `position: absolute` unless a
  // child opted out with `stackPositioning === "ABSOLUTE"`.
  if (isRealFlex || inferredLayoutDirection !== undefined) {
    for (const child of node.children) {
      if (child && child.stackPositioning?.name === "ABSOLUTE") {
        return true;
      }
    }
    return false;
  }
  // Static parent — every direct child paints absolute, so this node
  // must serve as their positioning ancestor.
  for (const child of node.children) {
    if (child && child.visible !== false) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a child flows in the parent's auto-layout. Figma honours the
 * authored auto-layout for every child unless the child opts out via
 * `stackPositioning === "ABSOLUTE"`.
 */
function childFlowsInParent(parent: ParentLayout, child: FigNode): boolean {
  if (parent !== "flex-row" && parent !== "flex-column") {
    return false;
  }
  return child.stackPositioning?.name !== "ABSOLUTE";
}

function axisSizingFrom(value: string | undefined): AxisSizing {
  if (value === "FILL") {
    return "fill";
  }
  if (value === "HUG") {
    return "hug";
  }
  return "fixed";
}

/**
 * Apply child sizing for an auto-layout flow child. The mapping is:
 *
 *   Primary axis (the flex direction):
 *     FIXED → width|height: <px>; flex-shrink: 0; (preserve authored size)
 *     HUG   → width|height: auto; flex: 0 0 auto;
 *     FILL  → flex: 1 1 0; (claim all available space, no fixed dim)
 *
 *   Counter axis (perpendicular):
 *     FIXED → counter: <px>
 *     HUG   → counter: auto
 *     FILL  → counter: 100% (or align-self: stretch when supported)
 *
 * The default flex behaviour is `flex-shrink: 1`, which means children
 * collapse to fit the container when their natural sizes overflow.
 * Figma's authored widths are intentional — a 348px wide row with five
 * 150px stories is meant to overflow horizontally (a mobile carousel),
 * NOT shrink each child to ~70px. Emitting `flex-shrink: 0` on every
 * non-FILL child preserves the authored shape.
 *
 * `stackChildAlignSelf` overrides counter-axis stretch behaviour.
 */
function applyChildSizing(
  node: FigNode,
  parent: ParentLayout,
  style: Record<string, string>,
  parentContext: ParentContext | undefined,
  textBound: boolean,
): void {
  const primary = axisSizingFrom(node.stackPrimarySizing?.name);
  const counter = axisSizingFrom(node.stackCounterSizing?.name);
  const isRow = parent === "flex-row";
  const counterAxis: "width" | "height" = isRow ? "height" : "width";
  const primaryAxis: "width" | "height" = isRow ? "width" : "height";

  applyAxis(node, primaryAxis, primary, style, textBound);
  applyCounterAxis(node, counterAxis, counter, style, parentContext, textBound);

  if (primary === "fill") {
    style.flexGrow = "1";
    style.flexShrink = "1";
    style.flexBasis = "0";
  } else {
    // FIXED / HUG primary axis: pin the authored width/height so the
    // browser does not collapse children when the row's intrinsic
    // content width exceeds the container.
    style.flexShrink = "0";
  }

  if (typeof node.stackChildPrimaryGrow === "number" && node.stackChildPrimaryGrow > 0) {
    style.flexGrow = `${node.stackChildPrimaryGrow}`;
  }

  const align = childAlignSelfCss(node.stackChildAlignSelf?.name);
  if (align) {
    style.alignSelf = align;
  }
}

/**
 * Counter-axis sizing.
 *
 * The "redundant FIXED counter" optimisation: when the parent
 * stretches on the counter axis and the child's authored counter
 * dimension equals the parent's content-counter, the explicit
 * dimension is removed. CSS `align-items: stretch` (default and
 * Figma's STRETCH alike) auto-fills children to the container's
 * inner counter axis; emitting the explicit value would just
 * duplicate that decision in pixels and lock the layout to a
 * specific viewport size.
 *
 * For non-stretch parents (Figma's MIN / CENTER / MAX) the explicit
 * dimension is retained — those alignments place children at a side
 * without stretching, so the browser needs the size to know where
 * the box ends.
 */
function applyCounterAxis(
  node: FigNode,
  axis: "width" | "height",
  sizing: AxisSizing,
  style: Record<string, string>,
  parentContext: ParentContext | undefined,
  textBound: boolean,
): void {
  if (sizing !== "fixed") {
    applyAxis(node, axis, sizing, style, textBound);
    return;
  }
  if (textAutoResizesAxis(node, axis, textBound)) {
    style[axis] = "auto";
    return;
  }
  if (!node.size) {
    return;
  }
  const value = axis === "width" ? node.size.x : node.size.y;
  if (canDropCounterDim(value, axis, parentContext)) {
    return;
  }
  style[axis] = formatPx(value);
}

function pickAxis(size: { readonly width: number; readonly height: number }, axis: "width" | "height"): number {
  return axis === "width" ? size.width : size.height;
}

function pickParentCounter(
  content: { readonly width: number; readonly height: number } | undefined,
  axis: "width" | "height",
): number | undefined {
  if (content === undefined) {
    return undefined;
  }
  return pickAxis(content, axis);
}

function canDropCounterDim(
  value: number,
  axis: "width" | "height",
  parentContext: ParentContext | undefined,
): boolean {
  if (!parentContext) {
    return false;
  }
  if (parentContext.alignItems !== "stretch") {
    return false;
  }
  const parentCounterValue = pickParentCounter(parentContext.content, axis);
  if (parentCounterValue === undefined) {
    return false;
  }
  return Math.abs(value - parentCounterValue) < 0.5;
}

function applyAxis(
  node: FigNode,
  axis: "width" | "height",
  sizing: AxisSizing,
  style: Record<string, string>,
  textBound: boolean,
): void {
  if (sizing === "fill") {
    style[axis] = "100%";
    return;
  }
  if (sizing === "hug") {
    style[axis] = "auto";
    return;
  }
  if (textAutoResizesAxis(node, axis, textBound)) {
    style[axis] = "auto";
    return;
  }
  if (!node.size) {
    return;
  }
  const value = axis === "width" ? node.size.x : node.size.y;
  style[axis] = formatPx(value);
}

/**
 * True when a TEXT node should let CSS measure its own length on
 * the requested axis.
 *
 * We only opt into `auto` when the TEXT is bound to a typed or
 * synthetic component prop — i.e. an INSTANCE may swap in a
 * different string at runtime, so the authored `node.size` no longer
 * matches the rendered content. For static text we honor Figma's
 * authored width *and* height: Figma renders `100% PERCENT`
 * line-height as the font's intrinsic line-height (≈19px for Roboto
 * Regular 16) while CSS `line-height: 100%` is exactly font-size
 * (16px), so an `auto` height collapses the box by the ascent
 * margin (~3px per line) and shifts every flex sibling below it
 * upward against the Figma SVG render. Pinning to `node.size.y`
 * keeps subsequent siblings aligned with the renderer; if the
 * runtime text overflows, the surrounding `overflow: hidden`
 * container clips it the same way Figma would.
 */
function textAutoResizesAxis(
  node: FigNode,
  axis: "width" | "height",
  textPropBound: boolean,
): boolean {
  if (node.type.name !== "TEXT") {
    return false;
  }
  const mode = node.textAutoResize?.name;
  const wantsAuto = mode === "HEIGHT" || mode === "WIDTH_AND_HEIGHT";
  if (!wantsAuto) {
    return false;
  }
  if (axis === "width" && mode !== "WIDTH_AND_HEIGHT") {
    return false;
  }
  return textPropBound;
}

function childAlignSelfCss(name: string | undefined): string | undefined {
  switch (name) {
    case "STRETCH":
      return "stretch";
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    default:
      return undefined;
  }
}

/**
 * Build the CSS-in-JS style record for a node.
 *
 * `mode` controls the *outer* role of this node:
 *   - "page-root" / "component-root" — the outermost element of a
 *     generated TSX file. Position is `relative`; size is the node's
 *     own size.
 *   - undefined — a descendant. Position depends on `parent`:
 *     flow when the parent is auto-layout and the child has not
 *     opted out via `ABSOLUTE`, absolute otherwise.
 *
 * `offsetBias` (optional) is the accumulated translation from
 * collapsed transparent-wrapper ancestors. It is added to the node's
 * own absolute `left` / `top` so the painted result stays identical
 * even when several wrapping layers were skipped during emission.
 */
export type StyleInputs = {
  readonly index: TokenIndex;
  readonly imageResolver: ImageResolver;
  /**
   * Set of TEXT-descendant guids whose `characters` are bound to a
   * component prop (typed or synthetic). When a node's guid is in
   * this set, the style emitter opts the TEXT into `width: auto`
   * because the authored width no longer reflects what will be
   * rendered at runtime.
   */
  readonly textBoundGuids?: ReadonlySet<string>;
};

/**
 * The flex context the parent of `node` will render into.
 *
 * `alignItems` is the parent's resolved CSS `align-items` — when
 * `stretch`, a counter-axis FIXED size on the child equal to the
 * parent's content size is redundant and gets dropped to keep the
 * generated CSS minimal.
 *
 * `content` is the parent's *inner* box (size minus padding) on each
 * axis. We compare child counter-axis dims against this to detect
 * "fills naturally" cases.
 */
export type ParentContext = {
  readonly alignItems?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  readonly content?: { readonly width: number; readonly height: number };
};

/**
 * Build a CSS-in-JS style record for one FigNode.
 *
 * `inferred` is the layout the JSX emitter has chosen for this
 * node's children — explicit `stackMode` first, then inferred via
 * `infer-layout` for non-auto-layout frames. The style emitter uses
 * this to (a) decide whether to add `display: flex` / padding / gap,
 * and (b) decide whether `position: relative` is needed (only when
 * descendants paint as `absolute`).
 */
export function nodeToStyle(
  node: FigNode,
  inputs: StyleInputs,
  rootMode: RootMode | undefined,
  parent: ParentLayout,
  offsetBias: { readonly dx: number; readonly dy: number } | undefined,
  inferred: InferenceResult,
  parentContext?: ParentContext,
): Record<string, string> {
  const style: Record<string, string> = {};
  const inferredDirection = inferred?.direction;
  applyLayout(node, rootMode, parent, style, offsetBias, inferredDirection, parentContext, inputs);
  applyPlainRule(node, inputs, style);
  applyVisuals(node, inputs, style);
  applyTextStyle(node, inputs, style);
  applyOwnLayoutMode(node, inputs.index, inferred, style);
  applyBlendMode(node, style);
  applyEffectFilters(node, style);
  return style;
}

/**
 * For LINE/VECTOR nodes that represent a plain solid horizontal or
 * vertical rule, override the post-layout dimensions so the
 * rendered `<div>` actually shows the line. Without this, a flex
 * child rule reaches CSS as `height: 0px` and the divider is
 * invisible.
 *
 * We deliberately run AFTER `applyLayout`, and only override when
 * the layout came out of `applyChildSizing` with a collapsed axis
 * (`width: 0px` or `height: 0px`). The absolute-positioning path
 * (`applyAbsolute` → `degenerateAxisExpansion`) already widened the
 * collapsed axis and shifted the centerline so the existing
 * `<svg>` overflow-visible trick draws the stroke at exactly the
 * page coordinates Figma's authoritative SVG renderer uses;
 * stomping on those values here would re-introduce a 1px shift
 * versus the renderer.
 */
function applyPlainRule(node: FigNode, inputs: StyleInputs, style: Record<string, string>): void {
  if (style.width !== "0px" && style.height !== "0px") {
    return;
  }
  const rule = computeRuleGeometry(node, inputs.index);
  if (!rule) {
    return;
  }
  style.width = formatPx(rule.width);
  style.height = formatPx(rule.height);
  style.background = rule.color;
}

function applyLayout(
  node: FigNode,
  rootMode: RootMode | undefined,
  parent: ParentLayout,
  style: Record<string, string>,
  offsetBias: { readonly dx: number; readonly dy: number } | undefined,
  inferredDirection: "row" | "column" | "inset" | undefined,
  parentContext: ParentContext | undefined,
  inputs: StyleInputs,
): void {
  // Self-position decision is independent of root vs descendant.
  // The layout regime imposed BY THIS NODE on its children influences
  // whether we need to be a positioning context.
  const needsPositioningContext = nodeNeedsPositioningContext(node, inferredDirection);
  const textBound = isTextPropBound(node, inputs);

  if (rootMode !== undefined) {
    if (needsPositioningContext) {
      style.position = "relative";
    }
    // A `component-root` is the SYMBOL's own root node, rendered
    // inside an INSTANCE `<div>` wrapper that already supplies the
    // outer position and size (often differing from the SYMBOL's
    // natural size — the "Mixes" pill instance is 56×30 even though
    // the underlying SYMBOL is 38×30). Sizing the SYMBOL root to
    // 100% lets it fill whichever wrapper it lands in, so the
    // SYMBOL's own padding / stack / borderRadius lay out against
    // the INSTANCE's authored bounds rather than the SYMBOL's
    // natural ones — a 38px pill centered inside a 56px wrapper
    // (the previous behaviour) is exactly the layered backing the
    // user objected to.
    if (rootMode === "component-root") {
      if (textAutoResizesAxis(node, "width", textBound)) {
        style.width = "auto";
      } else {
        style.width = "100%";
      }
      if (textAutoResizesAxis(node, "height", textBound)) {
        style.height = "auto";
      } else {
        style.height = "100%";
      }
      // CSS `box-sizing: border-box` keeps the SYMBOL's authored
      // padding inside the wrapper's content area instead of
      // expanding the rendered box past the wrapper bounds.
      style.boxSizing = "border-box";
      return;
    }
    if (node.size) {
      style.width = textAutoResizesAxis(node, "width", textBound) ? "auto" : formatPx(node.size.x);
      style.height = textAutoResizesAxis(node, "height", textBound) ? "auto" : formatPx(node.size.y);
    }
    return;
  }

  if (childFlowsInParent(parent, node)) {
    if (needsPositioningContext) {
      style.position = "relative";
    }
    applyChildSizing(node, parent, style, parentContext, textBound);
    return;
  }

  style.position = "absolute";
  const bx = offsetBias?.dx ?? 0;
  const by = offsetBias?.dy ?? 0;
  const expand = degenerateAxisExpansion(node);
  if (node.transform) {
    style.left = formatPx(node.transform.m02 + bx + expand.dx);
    style.top = formatPx(node.transform.m12 + by + expand.dy);
  } else if (bx !== 0 || by !== 0 || expand.dx !== 0 || expand.dy !== 0) {
    style.left = formatPx(bx + expand.dx);
    style.top = formatPx(by + expand.dy);
  }
  if (node.size) {
    style.width = pickAbsoluteAxis("width", node, expand, textBound);
    style.height = pickAbsoluteAxis("height", node, expand, textBound);
  }
}

function pickAbsoluteAxis(
  axis: "width" | "height",
  node: FigNode,
  expand: { readonly width: number | undefined; readonly height: number | undefined },
  textBound: boolean,
): string {
  if (textAutoResizesAxis(node, axis, textBound)) {
    return "auto";
  }
  if (axis === "width") {
    return formatPx(expand.width ?? node.size!.x);
  }
  return formatPx(expand.height ?? node.size!.y);
}

/**
 * True when `node` is a TEXT descendant whose `characters` are
 * supplied by a component prop binding. Plays into the
 * `width: auto` / `height: auto` opt-in for runtime-overridable
 * text — see `textAutoResizesAxis`.
 */
function isTextPropBound(node: FigNode, inputs: StyleInputs): boolean {
  if (node.type.name !== "TEXT") {
    return false;
  }
  const bound = inputs.textBoundGuids;
  if (!bound) {
    return false;
  }
  return bound.has(guidToString(node.guid));
}

/**
 * LINE nodes (and any other zero-thickness vector with a positive
 * stroke) carry a degenerate bounding box on one axis — Figma stores
 * the path-only geometry and relies on the stroke for visible
 * thickness. CSS layout boxes with width 0 or height 0 collapse and
 * clip the SVG, so we expand the collapsed axis by the stroke width
 * here and shift the corresponding position by half the stroke so
 * the visual centerline stays at Figma's authored coordinate.
 */
function degenerateAxisExpansion(node: FigNode): {
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly dx: number;
  readonly dy: number;
} {
  if (!node.size) {
    return { width: undefined, height: undefined, dx: 0, dy: 0 };
  }
  const stroke = maxStrokeForExpansion(node);
  if (stroke <= 0) {
    return { width: undefined, height: undefined, dx: 0, dy: 0 };
  }
  const widthCollapsed = node.size.x === 0;
  const heightCollapsed = node.size.y === 0;
  if (widthCollapsed && !heightCollapsed) {
    return { width: stroke, height: undefined, dx: -stroke / 2, dy: 0 };
  }
  if (heightCollapsed && !widthCollapsed) {
    return { width: undefined, height: stroke, dx: 0, dy: -stroke / 2 };
  }
  return { width: undefined, height: undefined, dx: 0, dy: 0 };
}

function maxStrokeForExpansion(node: FigNode): number {
  const w = node.strokeWeight;
  if (typeof w === "number") {
    return w;
  }
  if (w && typeof w === "object") {
    const candidates = [w.top, w.right, w.bottom, w.left].filter(
      (v): v is number => typeof v === "number",
    );
    if (candidates.length === 0) {
      return 0;
    }
    return Math.max(...candidates);
  }
  return 0;
}

function applyVisuals(node: FigNode, inputs: StyleInputs, style: Record<string, string>): void {
  // Vector-shaped nodes paint via SVG `<path>` elements, which carry
  // their own `fill` / `stroke` attributes; emitting CSS `background`
  // on the wrapping `<svg>` would paint the bounding box behind the
  // path. ELLIPSE with `arcData` joins the vector group for the same
  // reason — the synthesised arc must not sit on a solid disc.
  const isVectorShaped = VECTOR_SHAPED_TYPES.has(node.type.name)
    || (node.type.name === ELLIPSE_TYPE && hasEllipseArc(node));
  const isText = node.type.name === "TEXT";
  // INSTANCE wrappers render `<Component .../>` references whose own
  // root already paints the SYMBOL's `background`, `outline`,
  // `borderRadius`, and `shadow`. Figma stores these properties on the
  // INSTANCE too (mirroring the SYMBOL's defaults so the file
  // round-trips), and emitting them on the wrapper paints the same
  // shape twice — visible as a layered fringe whenever the wrapper
  // and the Component diverge by a sub-pixel after our INSTANCE
  // auto-layout adds padding. Skipping these on the wrapper lets the
  // Component own the visual representation; the wrapper keeps just
  // its layout role (position, size, own `stackMode`, opacity, clip).
  const isInstance = node.type.name === "INSTANCE";

  if (!isText && !isVectorShaped && !isInstance) {
    const fills = node.fillPaints ?? node.backgroundPaints;
    const bg = paintsToBackgroundStyle(fills, inputs.index, inputs.imageResolver);
    Object.assign(style, bg);
  }

  if (!isVectorShaped && !isInstance) {
    applyStroke(node, inputs, style);
  }

  const radius = radiusValue(node, inputs.index);
  if (radius !== undefined && !isInstance) {
    style.borderRadius = radius;
  }

  if (node.type.name === ELLIPSE_TYPE && !hasEllipseArc(node)) {
    style.borderRadius = "50%";
  }

  if (typeof node.opacity === "number" && node.opacity < 1) {
    style.opacity = `${round3(node.opacity)}`;
  }

  if (shouldClipContent(node)) {
    style.overflow = "hidden";
  }

  const shadow = shadowValue(node, inputs.index);
  if (shadow && !isInstance) {
    style.boxShadow = shadow;
  }
}

function strokeAlignFor(node: FigNode): FigStrokeAlign {
  return node.strokeAlign ?? "INSIDE";
}

function strokeColorCss(node: FigNode, inputs: StyleInputs): string | undefined {
  const stroke = node.strokePaints?.find((p) => p.visible !== false);
  if (!stroke) {
    return undefined;
  }
  const result = paintsToBackgroundStyle([stroke], inputs.index, inputs.imageResolver);
  // Only SOLID strokes survive as a clean colour — gradient strokes
  // are too rare to handle with a non-trivial CSS workaround. When
  // result has `background` but not `backgroundImage`, the stroke is
  // a SOLID — that's the supported case.
  return result.background;
}

function applyStroke(node: FigNode, inputs: StyleInputs, style: Record<string, string>): void {
  const sw = strokeWidth(node.strokeWeight);
  if (!sw || sw <= 0) {
    return;
  }
  const colour = strokeColorCss(node, inputs);
  if (!colour) {
    return;
  }
  applyStrokeWith(style, colour, sw, strokeAlignFor(node), node.strokeDashes);
}

function applyStrokeWith(
  style: Record<string, string>,
  colour: string,
  sw: number,
  align: FigStrokeAlign,
  dashes: readonly number[] | undefined,
): void {
  const dashed = Array.isArray(dashes) && dashes.length > 0;
  switch (align) {
    case "INSIDE": {
      // CSS `border` is inside-aligned and matches Figma.
      style.border = renderBorder(sw, colour, dashed);
      return;
    }
    case "OUTSIDE": {
      // `outline` paints OUTSIDE the box and does not affect layout.
      style.outline = renderBorder(sw, colour, dashed);
      style.outlineOffset = "0";
      return;
    }
    case "CENTER": {
      // CSS has no half-and-half outline. Approximate with `box-shadow`
      // (an inset-and-outset pair) or just split the stroke between
      // border and outline. We pick the outline-half approach: half
      // outside, half inside — which is what Figma actually paints.
      const half = sw / 2;
      style.outline = renderBorder(half, colour, dashed);
      style.outlineOffset = "0";
      style.boxShadow = `inset 0 0 0 ${formatPx(half)} ${colour}`;
      return;
    }
  }
}

function renderBorder(width: number, colour: string, dashed: boolean): string {
  const styleKeyword = dashed ? "dashed" : "solid";
  return `${formatPx(width)} ${styleKeyword} ${colour}`;
}

function applyTextStyle(node: FigNode, inputs: StyleInputs, style: Record<string, string>): void {
  if (node.type.name !== "TEXT") {
    return;
  }

  // When this TEXT will receive `width: auto` (because an INSTANCE
  // can override its characters at runtime — see
  // `textAutoResizesAxis`), force `white-space: nowrap` so a longer
  // override doesn't wrap inside the SYMBOL-authored fixed-size
  // wrapper. Figma renders these as overflowing single-line labels;
  // mirroring that keeps row-based components like Library "Your
  // videos" / "Your movies" on one line even though the SYMBOL's
  // outer container was sized for the shorter "History" default.
  if (style.width === "auto" && isTextPropBound(node, inputs)) {
    style.whiteSpace = "nowrap";
  }

  // Single-line text (baselines.length === 1) was rendered by Figma
  // on exactly one line, so its stored `size.x` is the exact pixel
  // width Figma's measurement reported. Browsers ship slightly
  // different font metric tables (and may also fall back to a
  // different Roboto build before the web font finishes loading),
  // which can push the same string a fraction of a pixel wider — and
  // a sub-pixel overshoot wraps the line, e.g. "Comments 149" at
  // Roboto Regular 12 measures 82px in Figma but ~83px in Chrome,
  // wrapping the "149" onto its own line. Forcing `nowrap` on text
  // that Figma declared single-line keeps the layout stable across
  // those measurement differences.
  if (!style.whiteSpace && isSingleBaselineText(node)) {
    style.whiteSpace = "nowrap";
  }

  const family = node.fontName?.family;
  const styleName = node.fontName?.style;
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : undefined;
  const lineHeight = lineHeightCss(node.lineHeight);
  const letterSpacing = letterSpacingCss(node.letterSpacing);

  if (family && styleName && fontSize !== undefined) {
    const tokenId = inputs.index.typographyIdFor(family, styleName, fontSize, lineHeight, letterSpacing);
    if (tokenId) {
      style.fontFamily = `var(--${tokenId}-font-family)`;
      style.fontSize = `var(--${tokenId}-font-size)`;
      style.fontWeight = `var(--${tokenId}-font-weight)`;
      if (lineHeight !== undefined) {
        style.lineHeight = `var(--${tokenId}-line-height)`;
      }
      if (letterSpacing !== undefined) {
        style.letterSpacing = `var(--${tokenId}-letter-spacing)`;
      }
    }
  }

  if (!style.fontFamily && family) {
    style.fontFamily = quoteFontFamily(family);
  }
  if (!style.fontSize && fontSize !== undefined) {
    style.fontSize = formatPx(fontSize);
  }
  // Authored line-height in PIXELS is the rendered per-line stride —
  // honour it verbatim. The derived-baseline path below addresses the
  // *AUTO / PERCENT* case where Figma's exporter pre-bakes the font's
  // intrinsic line-height into `derivedTextData.baselines[0].lineHeight`
  // and CSS would otherwise compute a different value from
  // `lineHeight: 100%`. When the author set an explicit pixel value
  // (the e-commerce hero "Buy your dream plants" sets `64px` to pack
  // its two lines tight against a `font-size: 64`) the derived
  // baseline lineHeight reflects the font's *natural* box, not the
  // rendered stride — using it here would expand each line by
  // `derivedLh - authored` and push every subsequent baseline down.
  // The `baselines[i+1].lineY - baselines[i].lineY` delta is the
  // authoritative stride; when it equals the authored value, defer to
  // the authored value.
  const explicitPixels = explicitPixelLineHeight(node);
  if (explicitPixels !== undefined && explicitPixels > 0) {
    style.lineHeight = formatPx(explicitPixels);
  } else {
    // Per-node override for AUTO / PERCENT: when the node carries
    // `derivedTextData.baselines`, its `lineHeight` field is the
    // actual rendered line height in pixels — Figma's exporter
    // pre-bakes the font's intrinsic line-height into this number for
    // any `100% PERCENT` style. CSS `line-height: 100%` is exactly
    // `font-size`, which is `fontSize × ascender_ratio` short of
    // Figma's rendered first-baseline; using the derived pixel value
    // instead lines the first baseline up with the SVG renderer's
    // first glyph row.
    const derivedLh = readDerivedBaselineLineHeight(node);
    if (derivedLh !== undefined) {
      // Figma auto-resizes single-line text to its glyph extent, leaving
      // `size.y` smaller than the font's natural `derivedLh`. Clamp
      // single-line text to its stored height so the inline box matches
      // the rendered bounds the parent's padding was sized against.
      const effective = clampLineHeightToBounds(node, derivedLh);
      style.lineHeight = formatPx(effective);
    } else if (!style.lineHeight && lineHeight !== undefined) {
      style.lineHeight = lineHeight;
    }
  }
  if (!style.letterSpacing && letterSpacing !== undefined) {
    style.letterSpacing = letterSpacing;
  }

  const text = paintsForText(node.fillPaints, inputs.index, inputs.imageResolver);
  if (text.color) {
    style.color = text.color;
  } else if (text.fancy) {
    Object.assign(style, text.fancy);
  }

  applyTextAlignment(node, style);
  applyTextCase(node, style);
  applyTextDecoration(node, style);
}

/**
 * Read the authored pixel line-height from `node.lineHeight` when the
 * units are `PIXELS`. Returns undefined for AUTO / PERCENT (the
 * caller falls through to the derived baseline path) so this helper
 * has no implicit defaults — every other unit category is rejected
 * by name rather than coerced.
 */
function explicitPixelLineHeight(node: FigNode): number | undefined {
  const lh = node.lineHeight;
  if (!lh) {
    return undefined;
  }
  if (lh.units.name !== "PIXELS") {
    return undefined;
  }
  return lh.value;
}

/**
 * Read Figma's pre-baked rendered line height (in CSS pixels) from
 * `derivedTextData.baselines[0].lineHeight`. This is the value the SVG
 * renderer uses as the line-box for path placement; mirroring it on
 * the React side keeps the first baseline aligned with the renderer's
 * even for the canonical `100% PERCENT` line-height stored on every
 * TEXT node in the YouTube fixture.
 */
function readDerivedBaselineLineHeight(node: FigNode): number | undefined {
  const dtd = (node as { readonly derivedTextData?: { readonly baselines?: ReadonlyArray<{ readonly lineHeight?: number }> } }).derivedTextData;
  const baselines = dtd?.baselines;
  if (!baselines || baselines.length === 0) {
    return undefined;
  }
  const lh = baselines[0]?.lineHeight;
  if (typeof lh !== "number" || lh <= 0) {
    return undefined;
  }
  return lh;
}

/**
 * Reduce the natural line-height to the stored bounds when Figma has
 * trimmed the TEXT to its visible glyph extent. A trimmed bound is one
 * where `size.y` is meaningfully smaller than the font's natural line
 * box; the parent's padding / explicit positioning was authored
 * against that smaller extent, so the CSS line box must also match it
 * or the glyph sits below where the parent's centring expects.
 *
 * Only collapses for single-baseline (i.e. single-line) TEXT — multi
 * line text needs the natural per-line height to keep subsequent lines
 * spaced correctly. The `1px` slack avoids fighting sub-pixel rounding
 * differences between Figma's stored size and the derived metric.
 */
/**
 * True when Figma laid out the TEXT on exactly one rendered line.
 * `derivedTextData.baselines` carries one entry per visible line
 * (post-wrapping), so `length === 1` is the authoritative signal.
 * Used to gate single-line-only behaviours like `nowrap` and the
 * line-height clamp below.
 */
function isSingleBaselineText(node: FigNode): boolean {
  const dtd = (node as { readonly derivedTextData?: { readonly baselines?: ReadonlyArray<unknown> } }).derivedTextData;
  return (dtd?.baselines?.length ?? 0) === 1;
}

function clampLineHeightToBounds(node: FigNode, derivedLh: number): number {
  if (!isSingleBaselineText(node)) {
    return derivedLh;
  }
  const sizeY = node.size?.y;
  if (typeof sizeY !== "number" || sizeY <= 0) {
    return derivedLh;
  }
  if (sizeY >= derivedLh - 1) {
    return derivedLh;
  }
  return sizeY;
}

function applyTextAlignment(node: FigNode, style: Record<string, string>): void {
  const horizontal = textAlignCss(node.textAlignHorizontal?.name);
  if (horizontal) {
    style.textAlign = horizontal;
  }
  // Vertical text alignment requires the TEXT node to participate in
  // a flex column itself: align-items handles vertical centering of
  // single-line text. For multi-line text Figma's CENTER pulls the
  // block centre, which CSS expresses as align-content on a flex
  // container around the span — that lives outside this style record
  // (the JSX wrapper handles it when needed).
}

function applyTextCase(node: FigNode, style: Record<string, string>): void {
  switch (node.textCase?.name) {
    case "UPPER":
      style.textTransform = "uppercase";
      return;
    case "LOWER":
      style.textTransform = "lowercase";
      return;
    case "TITLE":
      style.textTransform = "capitalize";
      return;
  }
}

function applyTextDecoration(node: FigNode, style: Record<string, string>): void {
  switch (node.textDecoration?.name) {
    case "UNDERLINE":
      style.textDecoration = "underline";
      return;
    case "STRIKETHROUGH":
      style.textDecoration = "line-through";
      return;
  }
}

function quoteFontFamily(family: string): string {
  return `${quoteFontName(family)}, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

function quoteFontName(family: string): string {
  if (/^[A-Za-z][A-Za-z0-9 _-]*$/.test(family)) {
    return `"${family}"`;
  }
  return JSON.stringify(family);
}

/**
 * Translate the chosen layout mode (explicit `stackMode` or inferred
 * shape) into CSS flex / padding / gap.
 *
 * Three sources feed this:
 *   - `node.stackMode === VERTICAL/HORIZONTAL` → emit Figma's
 *     authored auto-layout verbatim (gap / padding / alignment).
 *   - `inferred.direction === "row" | "column"` → the absolute
 *     children formed a stack we recognised; emit padding+gap+flex
 *     in lieu of per-child absolute positioning.
 *   - `inferred.direction === "inset"` → a single child wrapped by
 *     padding; emit padding only (no flex).
 */
/**
 * Does this node have at least one child that the JSX emitter will
 * render? Children that are explicitly hidden (`visible: false`) or
 * pure layout containers with no descendants drop out — the flex
 * styles on the parent would otherwise have nothing to flow.
 *
 * The check is intentionally local to keep this module independent
 * of the JSX `isRendered` predicate; it only inspects fields the
 * emitter also treats as visibility signals.
 */
function hasFlowableChildren(node: FigNode): boolean {
  if (!node.children || node.children.length === 0) {
    return false;
  }
  for (const child of node.children) {
    if (!child) {
      continue;
    }
    if (child.visible === false) {
      continue;
    }
    return true;
  }
  return false;
}

function applyOwnLayoutMode(
  node: FigNode,
  index: TokenIndex,
  inferred: InferenceResult,
  style: Record<string, string>,
): void {
  if (!ROOT_FRAME_TYPES.has(node.type.name)) {
    return;
  }
  const stackMode = node.stackMode?.name;
  if (stackMode === "VERTICAL" || stackMode === "HORIZONTAL") {
    applyExplicitStack(node, index, stackMode, style);
    return;
  }
  if (inferred?.direction === "row" || inferred?.direction === "column") {
    applyInferredStack(inferred, index, style);
    return;
  }
  if (inferred?.direction === "inset") {
    applyInferredInset(inferred, index, style);
  }
}

function applyExplicitStack(
  node: FigNode,
  index: TokenIndex,
  stackMode: "VERTICAL" | "HORIZONTAL",
  style: Record<string, string>,
): void {
  // Authored auto-layout on a frame with no children emits a flex
  // container that has nothing to flow. Image-to-fig (and similar
  // tools that flatten Figma trees) leaves this metadata on every
  // section background, producing decorative empty rectangles whose
  // padding / gap / align-items have no effect. Drop the entire flex
  // block in that case so the node renders as the painted rectangle
  // it actually is.
  //
  // INSTANCE wrappers are skipped entirely: an INSTANCE in Figma
  // inherits its SYMBOL's `stackMode` / padding / alignment, and the
  // emitted `<Component .../>` reference re-applies those on the
  // SYMBOL's own root. Emitting them again on the wrapper produces
  // nested padding (the YouTube "Mixes" pill: wrapper 56×30 padding
  // 8/12/8/12 + Component 38×30 padding 8/12/8/12 = a tiny inner
  // text box overflowing both frames). The wrapper now keeps only
  // its position / size / clip / opacity role; the Component (sized
  // to 100% via `applyLayout`) fills the wrapper and owns every
  // stack-derived rule.
  if (node.type.name === "INSTANCE") {
    return;
  }
  if (!hasFlowableChildren(node)) {
    return;
  }
  style.display = "flex";
  style.flexDirection = stackMode === "VERTICAL" ? "column" : "row";

  const padding = collapsePadding(node, index);
  if (padding) {
    style.padding = padding;
  }

  // `stackSpacing` is the *minimum* gap when the primary alignment
  // is SPACE_BETWEEN / SPACE_EVENLY / SPACE_AROUND (Figma stores the
  // residual spacing there but the CSS distribution algorithm
  // computes its own gaps). Emitting `gap` alongside one of those
  // justify modes adds the spacing twice, pushing children out of
  // the container. Only emit `gap` for the packed (MIN / MAX /
  // CENTER) alignments where authored spacing is what's painted.
  const primaryName = node.stackPrimaryAlignItems?.name;
  const isDistributedPrimary =
    primaryName === "SPACE_BETWEEN"
    || primaryName === "SPACE_EVENLY"
    || primaryName === "SPACE_AROUND";
  if (
    typeof node.stackSpacing === "number"
    && node.stackSpacing > 0
    && !isDistributedPrimary
  ) {
    style.gap = spacingValue(node.stackSpacing, index);
  }

  const align = stackAlignToCss(primaryName, "primary");
  if (align && align !== "flex-start") {
    style.justifyContent = align;
  }
  const cross = explicitCounterAlignToCss(node.stackCounterAlignItems?.name);
  if (cross !== "stretch") {
    style.alignItems = cross;
  }
  if (node.stackWrap === true) {
    style.flexWrap = "wrap";
  }
}

function applyInferredStack(
  inferred: InferredLayout,
  index: TokenIndex,
  style: Record<string, string>,
): void {
  style.display = "flex";
  style.flexDirection = inferred.direction;
  const padding = formatInferredPadding(inferred, index);
  if (padding) {
    style.padding = padding;
  }
  if (inferred.gap > 0) {
    style.gap = spacingValue(inferred.gap, index);
  }
  if (inferred.alignItems !== "stretch") {
    style.alignItems = inferred.alignItems;
  }
}

function applyInferredInset(
  inferred: InferredInset,
  index: TokenIndex,
  style: Record<string, string>,
): void {
  // Inset emits flex semantics so the inferred padding actually
  // pushes the child. CSS `padding` does not shift `position:
  // absolute` children, so emitting padding alone would leave the
  // child glued to (0,0) and the inferred padding would only count
  // as decoration. Flex makes the single child flow.
  style.display = "flex";
  const padding = formatInferredPadding(inferred, index);
  if (padding) {
    style.padding = padding;
  }
}

function formatInferredPadding(
  inferred: InferredLayout | InferredInset,
  index: TokenIndex,
): string | undefined {
  const t = inferred.paddingTop;
  const r = inferred.paddingRight;
  const b = inferred.paddingBottom;
  const l = inferred.paddingLeft;
  if (t === 0 && r === 0 && b === 0 && l === 0) {
    return undefined;
  }
  if (t === r && r === b && b === l) {
    return spacingValue(t, index);
  }
  if (t === b && r === l) {
    return `${spacingValue(t, index)} ${spacingValue(r, index)}`;
  }
  return [t, r, b, l].map((v) => spacingValue(v, index)).join(" ");
}

function collapsePadding(node: FigNode, index: TokenIndex): string | undefined {
  const top = node.stackVerticalPadding ?? node.stackPadding;
  const left = node.stackHorizontalPadding ?? node.stackPadding;
  const right = node.stackPaddingRight ?? left;
  const bottom = node.stackPaddingBottom ?? top;
  if (top === undefined && left === undefined && right === undefined && bottom === undefined) {
    return undefined;
  }
  const t = typeof top === "number" ? spacingValue(top, index) : "0";
  const r = typeof right === "number" ? spacingValue(right, index) : "0";
  const b = typeof bottom === "number" ? spacingValue(bottom, index) : "0";
  const l = typeof left === "number" ? spacingValue(left, index) : "0";
  if (t === r && r === b && b === l) {
    return t;
  }
  return `${t} ${r} ${b} ${l}`;
}

/**
 * Translate `stackCounterAlignItems` for an explicit auto-layout
 * frame. Returns Figma's MIN default (`flex-start`) when the field
 * is absent; CSS flex defaults to `stretch` so we must emit the
 * authored Figma default explicitly to avoid the children stretching
 * across the counter axis.
 */
function explicitCounterAlignToCss(
  name: string | undefined,
): "flex-start" | "flex-end" | "center" | "stretch" | "baseline" {
  switch (name) {
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    case "STRETCH":
      return "stretch";
    case "MIN":
    default:
      return "flex-start";
  }
}

function stackAlignToCss(name: string | undefined, axis: "primary" | "counter"): string | undefined {
  switch (name) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "SPACE_BETWEEN":
      return axis === "primary" ? "space-between" : undefined;
    case "SPACE_EVENLY":
      // Figma's SPACE_EVENLY paints children at the parent's edges
      // with the leftover space dropped between them — empirically
      // identical to CSS `space-between`, NOT CSS `space-evenly`
      // (which adds outer padding). Mapping it through
      // `space-between` matches the positions the Figma SVG renderer
      // emits and keeps icon groups (header right side) flush with
      // the container's inner edge.
      return axis === "primary" ? "space-between" : undefined;
    case "SPACE_AROUND":
      return axis === "primary" ? "space-around" : undefined;
    case "BASELINE":
      return axis === "counter" ? "baseline" : undefined;
    default:
      return undefined;
  }
}

function applyBlendMode(node: FigNode, style: Record<string, string>): void {
  const blend = node.blendMode;
  if (!blend) {
    return;
  }
  const css = blendModeToCss(blend);
  if (!css) {
    return;
  }
  style.mixBlendMode = css;
}

function blendModeToCss(blend: string): string | undefined {
  switch (blend) {
    case "PASS_THROUGH":
    case "NORMAL":
      return undefined;
    case "DARKEN":
      return "darken";
    case "MULTIPLY":
      return "multiply";
    case "LINEAR_BURN":
      return "plus-darker";
    case "COLOR_BURN":
      return "color-burn";
    case "LIGHTEN":
      return "lighten";
    case "SCREEN":
      return "screen";
    case "LINEAR_DODGE":
      return "plus-lighter";
    case "COLOR_DODGE":
      return "color-dodge";
    case "OVERLAY":
      return "overlay";
    case "SOFT_LIGHT":
      return "soft-light";
    case "HARD_LIGHT":
      return "hard-light";
    case "DIFFERENCE":
      return "difference";
    case "EXCLUSION":
      return "exclusion";
    case "HUE":
      return "hue";
    case "SATURATION":
      return "saturation";
    case "COLOR":
      return "color";
    case "LUMINOSITY":
      return "luminosity";
    default:
      return undefined;
  }
}

function effectTypeName(effect: FigEffect): FigEffectType | undefined {
  if (typeof effect.type === "string") {
    return effect.type;
  }
  return effect.type.name;
}

function applyEffectFilters(node: FigNode, style: Record<string, string>): void {
  const filters: string[] = [];
  const backdropFilters: string[] = [];
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) {
      continue;
    }
    const name = effectTypeName(effect);
    const radius = effect.radius;
    if (typeof radius !== "number" || radius <= 0) {
      continue;
    }
    if (name === "LAYER_BLUR" || name === "FOREGROUND_BLUR") {
      filters.push(`blur(${formatPx(radius)})`);
      continue;
    }
    if (name === "BACKGROUND_BLUR") {
      backdropFilters.push(`blur(${formatPx(radius)})`);
      continue;
    }
  }
  if (filters.length > 0) {
    style.filter = filters.join(" ");
  }
  if (backdropFilters.length > 0) {
    style.backdropFilter = backdropFilters.join(" ");
    style.WebkitBackdropFilter = backdropFilters.join(" ");
  }
}

