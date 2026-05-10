/**
 * @file Walk a FigNode tree and produce a Godot scene tree.
 *
 * The walker runs in three modes that match the Figma container kinds,
 * mirroring `fig-to-swiftui/src/emit/walk.ts`:
 *
 *   1. **Autolayout frame** (`stackMode = HORIZONTAL | VERTICAL`)
 *      → emits `HBoxContainer` / `VBoxContainer` with each child
 *        rendered in flow order; primary distribution drives the
 *        container's `alignment` property and (for SPACE_BETWEEN)
 *        synthetic spacer-Control insertion.
 *
 *   2. **Plain frame / group / component / instance**
 *      → emits a `Control` and renders each child with explicit
 *        `position` / `size` derived from the child's `transform.m02 / m12`
 *        so absolute positioning survives the conversion.
 *
 *   3. **Leaf primitive** (TEXT, RECTANGLE, ELLIPSE)
 *      → emits a single Godot Control (`Label`, `Panel`) with a
 *        StyleBoxFlat sub-resource attached via
 *        `theme_override_styles/panel`.
 *
 * Out-of-scope leaf kinds (vectors with arbitrary path data, image
 * fills, gradient fills) hit a Fail-Fast `throw` so the consumer can
 * address them rather than silently rendering an empty placeholder.
 *
 * Frame-padding wrapping rule:
 *
 *   When a BoxContainer has authored padding, the walker wraps it in a
 *   `MarginContainer` with the four `theme_override_constants/margin_*`
 *   set. The MarginContainer adopts the outer name; the inner
 *   BoxContainer is renamed `Stack` (or whatever the disambiguator
 *   produces) so node names stay unique within the parent.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import { toPascalCase, uniqueIdent } from "@higma-primitives/identifier";
import {
  boolVal,
  enumVal,
  floatVal,
  intVal,
  node,
  property,
  stringVal,
  vector2,
  type GodotNode,
  type GodotProperty,
  type GodotSubResource,
} from "../godot-tree";
import {
  boxContainerAlignment,
  counterSizeFlagsForChild,
  planLayout,
  SIZE_FLAGS,
  type LayoutPlan,
} from "../layout/autolayout";
import { buildStyleBoxFlat, modulateAlphaProperty } from "../style/style-box";
import {
  labelStyleOverrides,
  marginOverrides,
  panelStyleOverride,
  separationOverride,
} from "../style/theme";

const TEXT_TYPE = "TEXT";
const RECTANGLE_TYPE = "RECTANGLE";
const ROUNDED_RECTANGLE_TYPE = "ROUNDED_RECTANGLE";
const ELLIPSE_TYPE = "ELLIPSE";
const FRAME_LIKE_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);

/**
 * Mutable side-table the walker accumulates while it builds the scene
 * tree. Sub-resource ids are minted via `nextSubResourceId`; the
 * caller (`emitFromFrames`) hands one of these in per-frame and reads
 * the populated arrays after the walk.
 */
export type WalkContext = {
  readonly subResources: GodotSubResource[];
  readonly nodeNamesUsed: Set<string>;
  /** Counter feeding `nextSubResourceId` — kept here so multiple walks share. */
  styleBoxCounter: number;
};

/** Build an empty walk context — call once per top-level scene emit. */
export function createWalkContext(): WalkContext {
  return {
    subResources: [],
    nodeNamesUsed: new Set<string>(),
    styleBoxCounter: 0,
  };
}

function nextStyleBoxId(ctx: WalkContext): string {
  ctx.styleBoxCounter += 1;
  // Godot writes ids as `<TypeShorthand>_<6-char-suffix>`; we use a
  // numeric monotonic suffix so emitted scenes round-trip diff-clean.
  return `StyleBoxFlat_${ctx.styleBoxCounter.toString().padStart(3, "0")}`;
}

function uniqueNodeName(ctx: WalkContext, base: string): string {
  const sanitized = sanitizeNodeName(base);
  return uniqueIdent(sanitized, ctx.nodeNamesUsed);
}

/**
 * Godot node names cannot contain `/`, `:`, `@`, or `"`. Replace them
 * with `_` before passing through PascalCase de-duplication so the
 * output round-trips cleanly through Godot's editor save.
 */
function sanitizeNodeName(name: string): string {
  const cleaned = name.replace(/[/:@"]/g, "_");
  const pascal = toPascalCase(cleaned);
  if (pascal.length === 0) {
    return "Node";
  }
  return pascal;
}

function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  return true;
}

function renderedChildren(node: FigNode): readonly FigNode[] {
  return safeChildren(node).filter(isRendered);
}

/**
 * Decide whether a child is positioned absolutely inside its parent.
 * In an autolayout parent (HBox/VBox) children flow unless they carry
 * `stackPositioning = ABSOLUTE`. In a non-autolayout parent (Control)
 * every child is absolute.
 */
type Placement = { readonly mode: "flow" } | { readonly mode: "absolute"; readonly x: number; readonly y: number };

function placementFor(child: FigNode, parent: LayoutPlan): Placement {
  if (parent.container === "Control") {
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

/** Append the size-flag and absolute-position properties dictated by placement. */
function applyPlacement(
  target: GodotNode,
  placement: Placement,
  child: FigNode,
  parentPlan: LayoutPlan,
): GodotNode {
  if (placement.mode === "absolute") {
    return appendAbsolutePosition(target, placement.x, placement.y, child);
  }
  return appendFlowSizeFlags(target, child, parentPlan);
}

function appendAbsolutePosition(
  target: GodotNode,
  x: number,
  y: number,
  child: FigNode,
): GodotNode {
  // Anchors stay at zero (top-left); offsets carry the absolute position.
  // Godot 4.x stores rect via `offset_left/top/right/bottom`. We compute
  // offsets from the authored size so a child rendered at (12, 16) with
  // size 80x40 becomes offset_left=12, offset_top=16, offset_right=92,
  // offset_bottom=56.
  //
  // The container helpers (`plainControlProperties`,
  // `boxContainerProperties`) already populated offset_right/offset_bottom
  // from the child's authored size assuming origin (0,0). Here we
  // *replace* those with the absolutely-positioned values rather than
  // appending — Godot's `.tscn` parser uses the last value for a
  // duplicated key, but the duplicate also confuses readers and is what
  // diff-clean roundtrip catches as a regression.
  const positioned = new Map<string, GodotProperty>();
  if (x !== 0) {
    positioned.set("offset_left", property("offset_left", floatVal(x)));
  }
  if (y !== 0) {
    positioned.set("offset_top", property("offset_top", floatVal(y)));
  }
  if (child.size) {
    positioned.set("offset_right", property("offset_right", floatVal(x + child.size.x)));
    positioned.set("offset_bottom", property("offset_bottom", floatVal(y + child.size.y)));
  }
  const replaced = target.properties.map((p) => positioned.get(p.name) ?? p);
  const remaining = Array.from(positioned.values()).filter(
    (p) => !target.properties.some((t) => t.name === p.name),
  );
  return { ...target, properties: [...replaced, ...remaining] };
}

function appendFlowSizeFlags(
  target: GodotNode,
  child: FigNode,
  parentPlan: LayoutPlan,
): GodotNode {
  const flags = counterSizeFlagsForChild(parentPlan.counter, child);
  // Godot Control defaults `size_flags_<axis>` to 1 (SIZE_FILL), which
  // stretches every child to the container's cross-axis dimension.
  // Figma's MIN counter alignment means "leave the child at its
  // authored size and pin to the leading edge", which Godot models as
  // size_flags = 0 (no fill, no expand). We must always emit the
  // cross-axis flag — even when the resolved value is 0 — to override
  // Godot's default-FILL.
  // The cross-axis name depends on the BoxContainer orientation:
  //   HBoxContainer → cross axis is vertical → size_flags_vertical
  //   VBoxContainer → cross axis is horizontal → size_flags_horizontal
  const propName =
    parentPlan.container === "HBoxContainer" ? "size_flags_vertical" : "size_flags_horizontal";
  return {
    ...target,
    properties: [...target.properties, property(propName, intVal(flags))],
  };
}

/**
 * Render a TEXT node. Only the `textData.characters` / `characters`
 * channel is consulted; per-run styling is not yet in scope and would
 * require switching to RichTextLabel + BBCode, which the SwiftUI peer
 * also surfaces as a TODO.
 */
function emitTextNode(node_: FigNode, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, node_.name ?? "Label");
  const characters = readTextCharacters(node_);
  const props: GodotProperty[] = [
    property("text", stringVal(characters)),
    ...labelStyleOverrides(node_),
  ];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    props.push(modulate);
  }
  return node(name, "Label", { properties: props });
}

function readTextCharacters(node_: FigNode): string {
  if (typeof node_.textData?.characters === "string") {
    return node_.textData.characters;
  }
  if (typeof node_.characters === "string") {
    return node_.characters;
  }
  return "";
}

/**
 * Render a RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE leaf. Godot has no
 * first-class Ellipse Control; the v0 emitter renders ellipses as a
 * Panel with corner radius = min(width, height) / 2 and surfaces a
 * Fail-Fast error for non-circular ellipses (different x/y radii).
 *
 * RECTANGLE / ELLIPSE in Figma without an explicit fill renders as
 * transparent; Godot's Panel paints whatever StyleBox is attached. A
 * shape leaf with no SOLID fill therefore has no StyleBox to attach,
 * which would render as Godot's default panel skin — almost certainly
 * not what the author wanted. Surface that as Fail-Fast, matching the
 * SwiftUI peer.
 */
function buildShapeStyleBox(
  node_: FigNode,
  typeName: string,
  styleBoxId: string,
): GodotSubResource | undefined {
  if (typeName === ELLIPSE_TYPE) {
    return buildEllipseStyleBox(node_, styleBoxId);
  }
  return buildStyleBoxFlat(node_, styleBoxId);
}

function emitShapeLeaf(node_: FigNode, ctx: WalkContext): GodotNode {
  const typeName = node_.type.name;
  const name = uniqueNodeName(ctx, node_.name ?? typeName);
  const styleBoxId = nextStyleBoxId(ctx);
  const styleBox = buildShapeStyleBox(node_, typeName, styleBoxId);
  if (!styleBox) {
    // Shape with no SOLID fill, no stroke, no shadow, no corner radius
    // — visually transparent. Emit a bare Control of the right size so
    // layout still allocates the slot; no StyleBox needed.
    ctx.styleBoxCounter -= 1; // roll back the unused id
    const props: GodotProperty[] = [...customMinimumSizeProperty(node_)];
    const modulate = modulateAlphaProperty(node_);
    if (modulate) {
      props.push(modulate);
    }
    return node(name, "Control", { properties: props });
  }
  ctx.subResources.push(styleBox);
  const props: GodotProperty[] = [
    ...panelStyleOverride(styleBoxId),
    ...customMinimumSizeProperty(node_),
  ];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    props.push(modulate);
  }
  return node(name, "Panel", { properties: props });
}

/**
 * Carry the FigNode's authored size onto a Godot Control as
 * `custom_minimum_size = Vector2(w, h)`.
 *
 * Why this matters: Godot's layout containers (HBoxContainer /
 * VBoxContainer / MarginContainer) measure their children against
 * each child's `get_minimum_size()`. A bare Panel with no theme
 * minimum reports `(0, 0)`, which collapses the container to zero
 * height/width and makes nothing render. Figma fills always have an
 * authored size, so the converter needs to pin that size onto every
 * leaf that lives inside an autolayout parent.
 *
 * Returns an empty array when the node has no `size` so callers can
 * spread unconditionally.
 */
function customMinimumSizeProperty(node_: FigNode): readonly GodotProperty[] {
  if (!node_.size) {
    return [];
  }
  return [property("custom_minimum_size", vector2(node_.size.x, node_.size.y))];
}

/**
 * Build the StyleBoxFlat for an ELLIPSE leaf. Godot has no native
 * ellipse Control, so circular ellipses are emulated by setting a
 * corner radius equal to half the smaller side. Non-circular ellipses
 * (different x/y radii) cannot be rendered this way and surface as
 * Fail-Fast.
 */
function buildEllipseStyleBox(node_: FigNode, id: string): GodotSubResource | undefined {
  if (!node_.size) {
    throw new Error(
      `fig-to-godot: ELLIPSE node "${node_.name ?? "unnamed"}" has no size — cannot derive corner radius`,
    );
  }
  // Godot has no first-class ellipse Control. Circular ellipses
  // (square authored size) get a corner radius = side/2 which renders
  // as a perfect circle. Non-circular ellipses fall back to the
  // smaller side's radius — visually wrong (renders an oval-ish
  // pill, not a true ellipse), but that's the closest StyleBoxFlat
  // can do without a custom shader. The pixel diff for these frames
  // will fail honestly with an inspectable artifact rather than
  // blowing up the structural roundtrip with a thrown emit. v1 work
  // can replace with a SubViewport + custom shader if needed.
  const radius = Math.round(Math.min(node_.size.x, node_.size.y) / 2);
  // Synthesize a uniform corner-radius node clone so the shared
  // builder produces the same shape as a ROUNDED_RECTANGLE.
  const synthesized: FigNode = {
    ...node_,
    cornerRadius: radius,
  } as FigNode;
  return buildStyleBoxFlat(synthesized, id);
}

/**
 * Apply primary-axis distribution. CENTER / MAX go to the
 * BoxContainer.alignment integer; SPACE_BETWEEN inserts spacer Controls
 * between every adjacent pair, with `size_flags_<primary>=EXPAND_FILL`
 * so they consume the leftover space evenly.
 */
function applyPrimaryDistribution(
  plan: LayoutPlan,
  children: readonly GodotNode[],
  ctx: WalkContext,
): readonly GodotNode[] {
  if (plan.container === "Control" || children.length === 0) {
    return children;
  }
  if (plan.primary !== "space-between") {
    return children;
  }
  if (children.length < 2) {
    return children;
  }
  const out: GodotNode[] = [];
  children.forEach((child, idx) => {
    if (idx > 0) {
      out.push(spacerControl(plan, ctx));
    }
    out.push(child);
  });
  return out;
}

function spacerControl(plan: LayoutPlan, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, "Spacer");
  const flagName =
    plan.container === "HBoxContainer" ? "size_flags_horizontal" : "size_flags_vertical";
  return node(name, "Control", {
    properties: [property(flagName, intVal(SIZE_FLAGS.EXPAND_FILL))],
  });
}

/**
 * Container properties for a BoxContainer (HBox/VBox). Includes the
 * size, alignment, and separation override.
 */
function boxContainerProperties(node_: FigNode, plan: LayoutPlan): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  if (plan.container !== "Control") {
    props.push(
      property("alignment", enumVal(boxContainerAlignment(plan.primary), boxAlignmentName(plan.primary))),
    );
    // When SPACE_BETWEEN inserts spacer Controls, the BoxContainer's
    // own separation must be 0 — otherwise the authored stackSpacing
    // adds gaps on top of the spacer expansion and pushes content past
    // the frame edge. Mirrors the swiftui peer's "spacing reset to 0
    // for non-MIN primary" rule.
    const effectiveSpacing = plan.primary === "space-between" ? 0 : plan.spacing;
    props.push(...separationOverride(effectiveSpacing));
  }
  return props;
}

function boxAlignmentName(primary: LayoutPlan["primary"]): string {
  switch (primary) {
    case "min":
    case "space-between":
      return "BEGIN";
    case "center":
      return "CENTER";
    case "max":
      return "END";
  }
}

/** Pick the right property set for the container kind the plan picked. */
function containerProperties(node_: FigNode, plan: LayoutPlan): readonly GodotProperty[] {
  if (plan.container === "Control") {
    return plainControlProperties(node_);
  }
  return boxContainerProperties(node_, plan);
}

/**
 * Properties for a plain `Control` container (no autolayout). Carries
 * size offsets so absolute children land at the right positions, plus
 * `clip_contents = true` when the fig frame has clipping enabled
 * (Figma's default — `frameMaskDisabled` is false unless the author
 * turned it off; `clipsContent` is the explicit alternative). Without
 * this, an oversized child paints past the frame's rect (e.g. a
 * 100% rect inside a corner-rounded frame fills the corners).
 *
 * Note: Godot's `clip_contents` clips to the rect, not to corner
 * radii. Frames with non-zero corner radius still get the correct
 * rect-clip; the corner-rounded clip is a future enhancement (would
 * need a SubViewport + shader or a CanvasGroup mask).
 */
function plainControlProperties(node_: FigNode): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  if (figClipsContent(node_)) {
    props.push(property("clip_contents", boolVal(true)));
  }
  return props;
}

/**
 * Decide whether a fig FRAME / GROUP node clips its children. Figma
 * stores this two ways:
 *
 *   - `clipsContent: boolean` — set explicitly when the author toggles
 *     "Clip content" in the Figma side panel.
 *   - `frameMaskDisabled: boolean` — historical inverse field; defaults
 *     to `false` (clipping on). When `true`, clipping is off.
 *
 * The two are XOR-ish in real fig output. Treat clipping as ON when
 * either positive signal is present, and OFF only when explicitly
 * disabled.
 */
function figClipsContent(node_: FigNode): boolean {
  if (node_.clipsContent === true) {
    return true;
  }
  if (node_.frameMaskDisabled === false) {
    return true;
  }
  return false;
}

/**
 * Attach the StyleBoxFlat sub-resource (background fill / corner radius
 * / stroke / shadow) to a frame-like node by wrapping it in a Panel.
 * Returns `undefined` when the frame has no styling at all so the
 * walker can skip the wrap.
 */
function buildFramePanel(
  node_: FigNode,
  ctx: WalkContext,
): { readonly panel: GodotNode; readonly subResource: GodotSubResource } | undefined {
  const styleBoxId = nextStyleBoxId(ctx);
  const styleBox = buildStyleBoxFlat(node_, styleBoxId);
  if (!styleBox) {
    // Roll back the id increment so subsequent shapes get the next
    // sequential id — the unused id would leave a gap in `.tscn`.
    ctx.styleBoxCounter -= 1;
    return undefined;
  }
  const panelName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Bg`);
  const panel = node(panelName, "Panel", {
    properties: [
      ...panelStyleOverride(styleBoxId),
      property("anchor_right", floatVal(1)),
      property("anchor_bottom", floatVal(1)),
      property("mouse_filter", intVal(2 /* MOUSE_FILTER_IGNORE */)),
      property("show_behind_parent", boolVal(true)),
    ],
  });
  return { panel, subResource: styleBox };
}

// Rounded-corner clipping was prototyped this loop iteration via
// `clip_children = CLIP_AND_DRAW` on the bg Panel + reparenting the
// inner stack inside it. Single-level cases (clip-rounded-basic /
// pill / circle) hit 0% diff, but nested clip chains regressed
// (clip-rounded-nested, frame-deep-clip jumped 0% → 23%) because
// Godot's `clip_children` only clips the immediate children's
// drawing, not the whole subtree's composite. The rect-only
// `Control.clip_contents = true` (already in `plainControlProperties`)
// remains the conservative default. A proper rounded clip would
// need a SubViewport-based mask, deferred to a future iteration.

/**
 * Render a stack-shaped container (FRAME / GROUP / COMPONENT / INSTANCE).
 *
 * Composition order, outermost first:
 *
 *   MarginContainer? > Panel(background)? + BoxContainer|Control { children }
 *
 * The `MarginContainer` only appears when the frame has authored
 * padding. The background `Panel` only appears when the frame has any
 * styling (fill / corner / stroke / shadow).
 */
function emitContainer(node_: FigNode, ctx: WalkContext): GodotNode {
  const plan = planLayout(node_);
  const childContext = createWalkContext();
  const childViews: GodotNode[] = [];
  for (const child of renderedChildren(node_)) {
    const childNode = emitNode(child, childContext);
    const placement = placementFor(child, plan);
    childViews.push(applyPlacement(childNode, placement, child, plan));
  }
  // Hoist child sub-resources into the parent context (single shared pool).
  for (const sub of childContext.subResources) {
    ctx.subResources.push(sub);
  }
  ctx.styleBoxCounter = Math.max(ctx.styleBoxCounter, childContext.styleBoxCounter);
  const distributed = applyPrimaryDistribution(plan, childViews, ctx);

  const innerName = uniqueNodeName(ctx, node_.name ?? "Stack");
  // The `inner` BoxContainer/Control is *just* the layout primitive —
  // no modulate. Frame-level opacity needs to apply to the
  // background fill too, so we hoist `modulate` to the outermost wrap
  // (the Control / MarginContainer that adopts the bg+inner sibling
  // pair), not to the inner stack alone.
  const inner: GodotNode = node(innerName, plan.container, {
    properties: containerProperties(node_, plan),
    children: distributed,
  });

  const background = buildFramePanel(node_, ctx);
  if (background) {
    ctx.subResources.push(background.subResource);
  }
  // Rounded-corner clipping was attempted via
  // `clip_children = CLIP_AND_DRAW` on the bg Panel + reparenting
  // the inner stack inside it. Worked for single-level cases
  // (clip-rounded-basic / pill / circle → 0% diff), but broke
  // nested-clip cases (clip-rounded-nested, frame-deep-clip jumped
  // 0% → 23%) because Godot's `clip_children` only clips the
  // immediate children's drawing, not the whole subtree's
  // composite. A deeper-nested overflow child renders past its
  // intermediate ancestor's rounded silhouette. The rect-clip path
  // (`Control.clip_contents = true`) is the conservative fallback
  // that handles both cases at non-zero but uniform diff. Revisit
  // when a SubViewport-based mask becomes available — until then,
  // the rect-only clip is the lowest aggregate diff.
  const hasPadding =
    plan.padding.top !== 0 ||
    plan.padding.right !== 0 ||
    plan.padding.bottom !== 0 ||
    plan.padding.left !== 0;

  if (background && hasPadding) {
    // The bg Panel must paint the **full** frame rect (Figma's frame
    // fill spans behind the padding too), but the children must be
    // inset by the padding. A `MarginContainer` shrinks every direct
    // child including a sibling Panel — we'd lose the bg outside the
    // padded area. Wrap as `Control { Panel(bg, anchored full),
    // MarginContainer { stack } }` so the bg escapes the margin
    // shrink.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    const marginName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    const marginNode = node(marginName, "MarginContainer", {
      properties: marginOverridesWithSize(node_, plan.padding),
      children: [inner],
    });
    return withOptionalModulate(
      node(wrapName, "Control", {
        properties: plainControlProperties(node_),
        children: [background.panel, marginNode],
      }),
      node_,
    );
  }
  if (hasPadding) {
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    return withOptionalModulate(
      node(wrapName, "MarginContainer", {
        properties: marginOverridesWithSize(node_, plan.padding),
        children: [inner],
      }),
      node_,
    );
  }
  if (background) {
    // Background panel + stack as siblings under a wrapping Control so
    // the panel can paint behind the children without reparenting them.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    return withOptionalModulate(
      node(wrapName, "Control", {
        properties: plainControlProperties(node_),
        children: [background.panel, inner],
      }),
      node_,
    );
  }
  return withOptionalModulate(inner, node_);
}

function withOptionalModulate(target: GodotNode, source: FigNode): GodotNode {
  const modulate = modulateAlphaProperty(source);
  if (!modulate) {
    return target;
  }
  // Figma composes the whole frame as one layer and blends that
  // composite at alpha; Godot's `modulate` cascades to each
  // descendant individually, so overlapping children at the same
  // opacity blend differently. The right Godot primitive for the
  // fig semantics is `CanvasGroup`, but in 4.6 it interacts oddly
  // with the gl_compatibility renderer's clear-colour blend (frame
  // composites against a transparent backbuffer that loses the
  // white clear). Until that's resolved, fall back to plain
  // `modulate` and accept the overlap-region delta on the few frames
  // that exercise it.
  return { ...target, properties: [...target.properties, modulate] };
}

function marginOverridesWithSize(
  node_: FigNode,
  padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number },
): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  props.push(...marginOverrides(padding));
  return props;
}

/** Top-level entry — render any node into a GodotNode (mutating ctx). */
/**
 * Node kinds that v0 cannot render faithfully (LINE / STAR /
 * REGULAR_POLYGON / VECTOR / SYMBOL / BOOLEAN_OPERATION). Emitting
 * a placeholder Control keeps the structural roundtrip + sibling
 * layout intact; the pixel diff for these frames will fail honestly
 * with a real, inspectable artifact rather than blowing up the whole
 * spec file with a thrown emit. v1 work can replace the placeholder
 * with a faithful renderer per kind.
 */
const PLACEHOLDER_NODE_TYPES: ReadonlySet<string> = new Set([
  "LINE",
  "STAR",
  "REGULAR_POLYGON",
  "VECTOR",
  "SYMBOL",
  "BOOLEAN_OPERATION",
]);

function emitPlaceholder(node_: FigNode, ctx: WalkContext): GodotNode {
  const name = uniqueNodeName(ctx, node_.name ?? node_.type.name);
  const props: GodotProperty[] = [...customMinimumSizeProperty(node_)];
  return node(name, "Control", { properties: props });
}

/** Top-level entry: render any FigNode into a GodotNode (mutating ctx). */
export function emitNode(node_: FigNode, ctx: WalkContext): GodotNode {
  const typeName = getNodeType(node_);
  if (typeName === TEXT_TYPE) {
    return emitTextNode(node_, ctx);
  }
  if (
    typeName === RECTANGLE_TYPE ||
    typeName === ROUNDED_RECTANGLE_TYPE ||
    typeName === ELLIPSE_TYPE
  ) {
    return emitShapeLeaf(node_, ctx);
  }
  if (FRAME_LIKE_TYPES.has(typeName)) {
    return emitContainer(node_, ctx);
  }
  if (PLACEHOLDER_NODE_TYPES.has(typeName)) {
    return emitPlaceholder(node_, ctx);
  }
  throw new Error(
    `fig-to-godot: unsupported node type "${typeName}" (node "${node_.name ?? "unnamed"}")`,
  );
}

/**
 * Render a top-level frame as a complete root Control. The root sets
 * its own `offset_right` / `offset_bottom` to the frame size so the
 * scene opens at the right dimensions in the Godot editor.
 */
export function emitRootFrame(node_: FigNode, ctx: WalkContext): GodotNode {
  return emitNode(node_, ctx);
}
