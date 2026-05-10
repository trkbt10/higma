/**
 * @file Translate Figma `stackMode` autolayout to SwiftUI stack semantics.
 *
 * Figma's autolayout vocabulary:
 *
 *   - `stackMode`           HORIZONTAL | VERTICAL
 *   - `stackPrimaryAlignItems`   MIN | CENTER | MAX | SPACE_BETWEEN
 *   - `stackCounterAlignItems`   MIN | CENTER | MAX | STRETCH | BASELINE
 *   - `stackPadding`             uniform numeric padding
 *   - `stackHorizontalPadding`   horizontal padding override
 *   - `stackVerticalPadding`     vertical padding override
 *   - `stackPaddingRight`        right padding override
 *   - `stackPaddingBottom`       bottom padding override
 *   - `stackSpacing`             gap between children (px)
 *
 * SwiftUI's stack vocabulary:
 *
 *   - `HStack`/`VStack` accept a CROSS-axis `alignment:` parameter.
 *     The primary axis is laid out by the stack itself; SPACE_BETWEEN /
 *     CENTER on primary is realised with `Spacer()` insertions, not via
 *     a stack argument.
 *   - `ZStack` carries a 2D `alignment:` (.topLeading … .bottomTrailing).
 *
 * This module converts the Figma fields into the small `LayoutPlan` value
 * the emit walker consumes — no rendering, just the shape of the
 * resulting SwiftUI stack.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { StackKind, SwiftAlignment } from "../swift-tree/types";

/** Padding inferred from a frame's stack-padding fields, per side, in px. */
export type Padding = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

/**
 * The primary-axis distribution mode the emitter cares about. Figma's
 * MIN / CENTER / MAX / SPACE_BETWEEN map onto a fixed set of choices
 * that drive Spacer insertion in the emit walker — there is no SwiftUI
 * stack parameter that expresses them directly.
 */
export type PrimaryDistribution = "min" | "center" | "max" | "space-between";

/** Result of translating a Figma frame's autolayout to SwiftUI stack semantics. */
export type LayoutPlan = {
  readonly stack: StackKind;
  /** Cross-axis alignment for HStack / VStack. */
  readonly alignment?: SwiftAlignment;
  /** Spacing between children (HStack / VStack only). */
  readonly spacing?: number;
  /** Resolved per-side padding from `stackPadding*` fields. */
  readonly padding: Padding;
  /** Primary-axis distribution (HStack / VStack only). */
  readonly primary: PrimaryDistribution;
};

const ZERO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Pick the stack kind. A frame with explicit `stackMode` HORIZONTAL or
 * VERTICAL becomes the matching stack; everything else becomes a
 * ZStack — Figma frames without autolayout position children via
 * `transform`, which the emit walker realises with `.offset(...)`
 * inside a ZStack.
 */
export function pickStackKind(node: FigNode): StackKind {
  const mode = node.stackMode?.name;
  if (mode === "HORIZONTAL") {
    return "HStack";
  }
  if (mode === "VERTICAL") {
    return "VStack";
  }
  return "ZStack";
}

/** Resolve per-side padding from a node's `stackPadding*` fields.
 *
 * INSIDE-aligned strokes on the frame consume layout space in
 * Figma's autolayout — the children are inset by `padding +
 * strokeWidth` from the frame edge so the stroke (painted in the
 * outer ring) doesn't overlap them. CENTER / OUTSIDE strokes don't
 * affect layout. We fold the stroke width into the resolved padding
 * here so the SwiftUI `.padding(...)` modifier inherits the same
 * total inset; the stroke overlay still paints from x=0 outward.
 */
export function resolvePadding(node: FigNode): Padding {
  const horizontal = node.stackHorizontalPadding ?? node.stackPadding;
  const vertical = node.stackVerticalPadding ?? node.stackPadding;
  const right = node.stackPaddingRight ?? horizontal;
  const bottom = node.stackPaddingBottom ?? vertical;
  // Stroke insets are only relevant when the frame is doing
  // autolayout — those children flow inside `.padding(...)` and
  // need the extra inset to avoid the painted stroke band. For
  // ZStack containers, children use `.offset(x:, y:)` from the
  // node's transform, which already accounts for the absolute
  // position; folding stroke into padding there would shift the
  // children twice.
  const isAutolayout = pickStackKind(node) !== "ZStack";
  const strokeInset = isAutolayout ? insideStrokeWidth(node) : 0;
  if (
    horizontal === undefined &&
    vertical === undefined &&
    right === undefined &&
    bottom === undefined &&
    strokeInset === 0
  ) {
    return ZERO_PADDING;
  }
  return {
    top: (vertical ?? 0) + strokeInset,
    right: (right ?? 0) + strokeInset,
    bottom: (bottom ?? 0) + strokeInset,
    left: (horizontal ?? 0) + strokeInset,
  };
}

/** Read the node's INSIDE-stroke width (the bit that consumes
 * layout space). Returns 0 when:
 *
 *   - the node has no visible stroke,
 *   - the stroke alignment is not INSIDE,
 *   - the strokeWeight is zero / per-side (per-side isn't supported
 *     by the stroke-overlay helper either, so consistency wins),
 *   - or the node carries `bordersTakeSpace: false` — Figma
 *     exposes this toggle in the UI as "Include borders in
 *     spacing" and a `false` value means strokes paint without
 *     consuming layout space (the default behaviour for older
 *     designs; new files default to `true`).
 */
function insideStrokeWidth(node: FigNode): number {
  const bordersTakeSpace = (node as { bordersTakeSpace?: boolean }).bordersTakeSpace;
  if (bordersTakeSpace === false) {
    return 0;
  }
  const align = node.strokeAlign;
  const alignName = typeof align === "string" ? align : align?.name;
  if (alignName !== "INSIDE") {
    return 0;
  }
  if (!hasVisibleStroke(node)) {
    return 0;
  }
  const weight = node.strokeWeight;
  if (weight === undefined) {
    return 0;
  }
  if (typeof weight === "number") {
    return weight > 0 ? weight : 0;
  }
  return 0;
}

function hasVisibleStroke(node: FigNode): boolean {
  const paints = node.strokePaints;
  if (!paints || paints.length === 0) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible !== false) {
      return true;
    }
  }
  return false;
}

/**
 * Map Figma counter-axis alignment to SwiftUI alignment for an HStack.
 *
 * Figma's default counter-axis alignment is MIN when `stackCounterAlignItems`
 * is unset; SwiftUI's HStack default is `.center`. The two disagree, so the
 * emitter must always supply `alignment:` for HStack/VStack to preserve
 * Figma fidelity — never returns undefined.
 */
export function counterAlignmentForHStack(node: FigNode): SwiftAlignment {
  const name = node.stackCounterAlignItems?.name;
  switch (name) {
    case "MAX":
      return "bottom";
    case "CENTER":
      return "center";
    case "BASELINE":
      // SwiftUI HStack supports `.firstTextBaseline` and `.lastTextBaseline`;
      // Figma's BASELINE matches firstTextBaseline structurally, but the
      // SwiftAlignment IR only carries the four primary anchors so we map
      // BASELINE to `.top` (matching MIN) and document the limitation.
      return "top";
    case "STRETCH":
      // SwiftUI HStack has no stretch alignment; children stretch via
      // explicit `.frame(maxHeight: .infinity)` instead. The emitter picks
      // `.top` and stretches each child's frame as a follow-up — giving
      // the same visual outcome.
      return "top";
    case "MIN":
    default:
      return "top";
  }
}

/**
 * Map Figma counter-axis alignment to SwiftUI alignment for a VStack.
 *
 * Defaults to MIN (`.leading`) when `stackCounterAlignItems` is absent —
 * matches Figma's default and overrides SwiftUI's `.center`.
 */
export function counterAlignmentForVStack(node: FigNode): SwiftAlignment {
  const name = node.stackCounterAlignItems?.name;
  switch (name) {
    case "MAX":
      return "trailing";
    case "CENTER":
      return "center";
    case "STRETCH":
      // VStack lacks stretch — same approach as HStack STRETCH.
      return "leading";
    case "BASELINE":
      // BASELINE on a VStack is a Figma-side artefact (cross-axis text
      // alignment is meaningful only on the row axis). Fall back to MIN.
      return "leading";
    case "MIN":
    default:
      return "leading";
  }
}

/** Map Figma primary-axis alignment to the small enum the emitter uses. */
export function primaryDistribution(node: FigNode): PrimaryDistribution {
  const name = node.stackPrimaryAlignItems?.name;
  switch (name) {
    case "CENTER":
      return "center";
    case "MAX":
      return "max";
    case "SPACE_BETWEEN":
      return "space-between";
    case "MIN":
    default:
      return "min";
  }
}

/** Build the full LayoutPlan for a frame node. */
export function planLayout(node: FigNode): LayoutPlan {
  const stack = pickStackKind(node);
  const padding = resolvePadding(node);
  const spacing = typeof node.stackSpacing === "number" ? node.stackSpacing : undefined;
  if (stack === "HStack") {
    return {
      stack,
      alignment: counterAlignmentForHStack(node),
      spacing,
      padding,
      primary: primaryDistribution(node),
    };
  }
  if (stack === "VStack") {
    return {
      stack,
      alignment: counterAlignmentForVStack(node),
      spacing,
      padding,
      primary: primaryDistribution(node),
    };
  }
  // ZStack: alignment defaults to `topLeading` because Figma frames
  // anchor their children to the (0,0) corner of the parent. Picking
  // `.center` (SwiftUI's ZStack default) would shift every absolute
  // child by half the frame size.
  return {
    stack: "ZStack",
    alignment: "topLeading",
    spacing: undefined,
    padding,
    primary: "min",
  };
}
