/**
 * @file Translate Figma `stackMode` autolayout to Godot container semantics.
 *
 * Figma's autolayout vocabulary (mirrored from `fig-to-swiftui`):
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
 * Godot's container vocabulary (Godot 4.x):
 *
 *   - `HBoxContainer` / `VBoxContainer` carry primary-axis alignment as
 *     the integer `alignment` property: 0=BEGIN, 1=CENTER, 2=END. There
 *     is no built-in SPACE_BETWEEN for BoxContainer — that case still
 *     needs synthetic spacer `Control` siblings with
 *     `size_flags_horizontal/vertical = SIZE_EXPAND_FILL`.
 *   - Cross-axis alignment is per-child via `size_flags_*` overrides
 *     (BEGIN / CENTER / END / FILL / EXPAND_FILL / SHRINK_CENTER /
 *     SHRINK_END). The container does not carry a counter-axis enum.
 *   - Padding is not a BoxContainer property; the canonical pattern is
 *     `MarginContainer > BoxContainer` with the four
 *     `theme_override_constants/margin_*` set on the MarginContainer.
 *   - Spacing between children is the `theme_override_constants/separation`
 *     property on the BoxContainer.
 *
 * This module produces the small `LayoutPlan` value the emit walker
 * consumes — no rendering, just the shape of the resulting Godot
 * container chain.
 */
import type { FigNode } from "@higma-document-models/fig/types";

/** Godot Control container kind that the emitter targets. */
export type GodotContainerKind = "HBoxContainer" | "VBoxContainer" | "Control";

/** Padding inferred from a frame's stack-padding fields, per side, in px. */
export type Padding = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

/**
 * The primary-axis distribution mode the emitter cares about. Figma's
 * MIN / CENTER / MAX / SPACE_BETWEEN map onto a fixed set of Godot
 * choices. MIN / CENTER / MAX go straight to `BoxContainer.alignment`;
 * SPACE_BETWEEN drives synthetic spacer insertion in the walker.
 */
export type PrimaryDistribution = "min" | "center" | "max" | "space-between";

/**
 * Cross-axis alignment for HBox / VBox children. Godot exposes this as
 * `size_flags_<cross-axis>` per child rather than as a parent-level
 * enum, so the plan carries the resolved per-child default which the
 * walker applies to every child unless overridden by
 * `stackChildAlignSelf`.
 */
export type CounterAlignment = "begin" | "center" | "end" | "fill";

/** Result of translating a Figma frame's autolayout to Godot container semantics. */
export type LayoutPlan = {
  readonly container: GodotContainerKind;
  /** Cross-axis default alignment (resolved per child via size_flags). */
  readonly counter: CounterAlignment;
  /** Spacing between children (HBox / VBox only). */
  readonly spacing?: number;
  /** Resolved per-side padding from `stackPadding*` fields. */
  readonly padding: Padding;
  /** Primary-axis distribution. */
  readonly primary: PrimaryDistribution;
};

const ZERO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Pick the container kind. A frame with explicit `stackMode` HORIZONTAL
 * or VERTICAL becomes the matching BoxContainer; everything else
 * becomes a plain `Control` — Figma frames without autolayout position
 * children via `transform`, which the walker realises with `position`
 * + `size` on each child Control.
 */
export function pickContainerKind(node: FigNode): GodotContainerKind {
  const mode = node.stackMode?.name;
  if (mode === "HORIZONTAL") {
    return "HBoxContainer";
  }
  if (mode === "VERTICAL") {
    return "VBoxContainer";
  }
  return "Control";
}

/**
 * Resolve per-side padding from a node's `stackPadding*` fields.
 * Identical resolution rule to `fig-to-swiftui` so the two emitters
 * agree on what "padding 12 left, 8 top" decodes to from a given fig
 * file.
 */
export function resolvePadding(node: FigNode): Padding {
  const horizontal = node.stackHorizontalPadding ?? node.stackPadding;
  const vertical = node.stackVerticalPadding ?? node.stackPadding;
  const right = node.stackPaddingRight ?? horizontal;
  const bottom = node.stackPaddingBottom ?? vertical;
  if (horizontal === undefined && vertical === undefined && right === undefined && bottom === undefined) {
    return ZERO_PADDING;
  }
  return {
    top: vertical ?? 0,
    right: right ?? 0,
    bottom: bottom ?? 0,
    left: horizontal ?? 0,
  };
}

/**
 * Map Figma's counter-axis alignment to Godot's per-child size-flag
 * default.
 *
 * Figma's default counter-axis alignment is MIN when
 * `stackCounterAlignItems` is unset. STRETCH on the parent is encoded
 * in Figma as per-child `stackChildAlignSelf=STRETCH`; the parent enum
 * itself does not carry STRETCH (see
 * `STACK_COUNTER_ALIGN_VALUES` doc comment in document-models). A
 * STRETCH that does land on the parent enum (legacy data) is treated
 * as `fill` here.
 */
export function counterAlignmentForBoxContainer(node: FigNode): CounterAlignment {
  const name = node.stackCounterAlignItems?.name;
  switch (name) {
    case "MAX":
      return "end";
    case "CENTER":
      return "center";
    case "STRETCH":
      // Legacy data — see header comment.
      return "fill";
    case "BASELINE":
      // Godot's BoxContainer has no baseline alignment. BASELINE on a
      // VBoxContainer is meaningless; on an HBoxContainer it would
      // require text metric integration that's out of v0 scope.
      // Falling back to BEGIN matches the SwiftUI peer's "BASELINE
      // collapses to MIN" rule.
      return "begin";
    case "MIN":
    default:
      return "begin";
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
  const container = pickContainerKind(node);
  const padding = resolvePadding(node);
  const spacing = typeof node.stackSpacing === "number" ? node.stackSpacing : undefined;
  if (container === "HBoxContainer" || container === "VBoxContainer") {
    return {
      container,
      counter: counterAlignmentForBoxContainer(node),
      spacing,
      padding,
      primary: primaryDistribution(node),
    };
  }
  // Non-autolayout container: children carry absolute `position` /
  // `size` and the parent `Control` does not distribute. Padding still
  // resolves so the walker can wrap in a MarginContainer when authored
  // padding is non-zero, but `primary` is meaningless and pinned to MIN.
  return {
    container: "Control",
    counter: "begin",
    spacing: undefined,
    padding,
    primary: "min",
  };
}

/** Godot integer for `BoxContainer.alignment`. SoT: Godot 4.x BoxContainer enum. */
export const BOX_CONTAINER_ALIGNMENT = {
  BEGIN: 0,
  CENTER: 1,
  END: 2,
} as const;

/**
 * Godot integer flags for `Control.size_flags_horizontal/vertical`.
 * SoT: Godot 4.x `Control.SizeFlags` enum.
 */
export const SIZE_FLAGS = {
  /** No flag — child takes its minimum size, anchored to BEGIN. */
  NONE: 0,
  /** Fill available space without expanding. */
  FILL: 1,
  /** Take a share of the leftover space (combine with FILL for FILL+EXPAND). */
  EXPAND: 2,
  /** Convenience: FILL | EXPAND — most common "fill the parent" combo. */
  EXPAND_FILL: 3,
  /** Shrink toward CENTER. */
  SHRINK_CENTER: 4,
  /** Shrink toward END. */
  SHRINK_END: 8,
} as const;

/**
 * Resolve the Godot `size_flags_<cross-axis>` integer for a child given
 * the parent's counter alignment and the child's own
 * `stackChildAlignSelf` override.
 */
export function counterSizeFlagsForChild(
  parentCounter: CounterAlignment,
  child: FigNode,
): number {
  const childAlign = child.stackChildAlignSelf?.name;
  if (childAlign === "STRETCH") {
    return SIZE_FLAGS.EXPAND_FILL;
  }
  // AUTO falls through to the parent default, matching Figma semantics.
  if (childAlign === "MIN") {
    return SIZE_FLAGS.NONE;
  }
  if (childAlign === "CENTER") {
    return SIZE_FLAGS.SHRINK_CENTER;
  }
  if (childAlign === "MAX") {
    return SIZE_FLAGS.SHRINK_END;
  }
  switch (parentCounter) {
    case "begin":
      return SIZE_FLAGS.NONE;
    case "center":
      return SIZE_FLAGS.SHRINK_CENTER;
    case "end":
      return SIZE_FLAGS.SHRINK_END;
    case "fill":
      return SIZE_FLAGS.EXPAND_FILL;
  }
}

/**
 * Resolve the integer for `BoxContainer.alignment`. SPACE_BETWEEN is
 * realised by spacer-Control insertion in the walker; the container
 * itself stays at BEGIN in that case so the spacers do all the work.
 */
export function boxContainerAlignment(primary: PrimaryDistribution): number {
  switch (primary) {
    case "min":
    case "space-between":
      return BOX_CONTAINER_ALIGNMENT.BEGIN;
    case "center":
      return BOX_CONTAINER_ALIGNMENT.CENTER;
    case "max":
      return BOX_CONTAINER_ALIGNMENT.END;
  }
}
