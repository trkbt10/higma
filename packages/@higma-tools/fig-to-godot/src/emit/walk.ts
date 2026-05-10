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
  const props: GodotProperty[] = [];
  // Anchors stay at zero (top-left); offsets carry the absolute position.
  // Godot 4.x stores rect via `offset_left/top/right/bottom`. We compute
  // offsets from the authored size so a child rendered at (12, 16) with
  // size 80x40 becomes offset_left=12, offset_top=16, offset_right=92,
  // offset_bottom=56.
  if (x !== 0) {
    props.push(property("offset_left", floatVal(x)));
  }
  if (y !== 0) {
    props.push(property("offset_top", floatVal(y)));
  }
  if (child.size) {
    props.push(property("offset_right", floatVal(x + child.size.x)));
    props.push(property("offset_bottom", floatVal(y + child.size.y)));
  }
  return { ...target, properties: [...target.properties, ...props] };
}

function appendFlowSizeFlags(
  target: GodotNode,
  child: FigNode,
  parentPlan: LayoutPlan,
): GodotNode {
  const flags = counterSizeFlagsForChild(parentPlan.counter, child);
  if (flags === SIZE_FLAGS.NONE) {
    return target;
  }
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
    throw new Error(
      `fig-to-godot: ${typeName} node "${node_.name ?? "unnamed"}" has no SOLID fill — gradients/images are not yet supported`,
    );
  }
  ctx.subResources.push(styleBox);
  const props: GodotProperty[] = [...panelStyleOverride(styleBoxId)];
  const modulate = modulateAlphaProperty(node_);
  if (modulate) {
    props.push(modulate);
  }
  return node(name, "Panel", { properties: props });
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
  if (Math.abs(node_.size.x - node_.size.y) > 1e-6) {
    throw new Error(
      `fig-to-godot: non-circular ELLIPSE is not supported (node "${node_.name ?? "unnamed"}" size=${node_.size.x}x${node_.size.y})`,
    );
  }
  const radius = Math.round(node_.size.x / 2);
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
 * size offsets so absolute children land at the right positions.
 */
function plainControlProperties(node_: FigNode): readonly GodotProperty[] {
  const props: GodotProperty[] = [];
  if (node_.size) {
    props.push(property("offset_right", floatVal(node_.size.x)));
    props.push(property("offset_bottom", floatVal(node_.size.y)));
  }
  return props;
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
  const inner: GodotNode = node(innerName, plan.container, {
    properties: containerProperties(node_, plan),
    children: distributed,
  });
  const innerWithModulate = withOptionalModulate(inner, node_);

  const background = buildFramePanel(node_, ctx);
  if (background) {
    ctx.subResources.push(background.subResource);
  }
  const hasPadding =
    plan.padding.top !== 0 ||
    plan.padding.right !== 0 ||
    plan.padding.bottom !== 0 ||
    plan.padding.left !== 0;

  if (background && hasPadding) {
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    return node(wrapName, "MarginContainer", {
      properties: marginOverridesWithSize(node_, plan.padding),
      children: [background.panel, innerWithModulate],
    });
  }
  if (hasPadding) {
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Margin`);
    return node(wrapName, "MarginContainer", {
      properties: marginOverridesWithSize(node_, plan.padding),
      children: [innerWithModulate],
    });
  }
  if (background) {
    // Background panel + stack as siblings under a wrapping Control so
    // the panel can paint behind the children without reparenting them.
    const wrapName = uniqueNodeName(ctx, `${node_.name ?? "Frame"}_Group`);
    return node(wrapName, "Control", {
      properties: plainControlProperties(node_),
      children: [background.panel, innerWithModulate],
    });
  }
  return innerWithModulate;
}

function withOptionalModulate(target: GodotNode, source: FigNode): GodotNode {
  const modulate = modulateAlphaProperty(source);
  if (!modulate) {
    return target;
  }
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
