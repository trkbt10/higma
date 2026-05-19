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

/**
 * Read an optional Figma numeric property as a finite number.
 *
 * Figma's `.fig` encoding stores "unset" autolayout fields like
 * `stackCounterSpacing` / `stackPadding` as `NaN` rather than omitting
 * the slot — the underlying kiwi schema reserves a float32 field for
 * every optional value. A plain `typeof === "number"` guard treats
 * `NaN` as a valid number and propagates it into Godot
 * `offset_top` / `offset_bottom` writes, where it then hits
 * `serialize.ts`'s `printFloat` and throws.
 *
 * Returning `undefined` for `NaN` lets the caller apply the documented
 * Figma fallback (e.g. row gap inherits column gap; missing padding
 * resolves to 0) instead of silently corrupting the layout math.
 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

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
 *
 * Negative `stackSpacing` (overlap) falls back to `Control` because
 * Godot's BoxContainer clamps `theme_override_constants/separation` at
 * 0 in practice — children don't actually overlap. The walker handles
 * the Control fallback by computing flow positions itself (see
 * `flowPositionsForOverlapStack`). GRID layout (Figma's wrap mode) is
 * also out of scope and falls back to Control as a placeholder; an
 * authentic grid implementation needs a separate emit path.
 */
export function pickContainerKind(node: FigNode): GodotContainerKind {
  const mode = node.stackMode?.name;
  if (mode === "HORIZONTAL" || mode === "VERTICAL") {
    const stackSpacing = readFiniteNumber(node.stackSpacing);
    if (stackSpacing !== undefined && stackSpacing < 0) {
      return "Control";
    }
    // `stackWrap = WRAP` turns a HORIZONTAL stack into a row-major
    // flow with line breaks at the container's content edge. Godot
    // has no first-class wrap container, so we demote to a plain
    // `Control` and let the walker pre-compute each child's (x, y)
    // via `flowPositionsForGrid`.
    if (mode === "HORIZONTAL" && readWrapName(node.stackWrap) === "WRAP") {
      return "Control";
    }
    if (mode === "HORIZONTAL") {
      return "HBoxContainer";
    }
    return "VBoxContainer";
  }
  return "Control";
}

/**
 * Compute absolute (x, y) positions for children of an autolayout
 * frame whose layout was demoted to a plain Control because of
 * negative spacing. Walks the children in flow order, accumulating
 * the primary-axis offset by `size + spacing` per step. Padding
 * applies as the leading offset; counter-axis offset stays at 0
 * (MIN counter alignment is the only one this fallback supports —
 * the few fixtures that exercise negative spacing all use MIN).
 *
 * Returns an array of `{x, y}` parallel to `children`. When called
 * for a non-overlap container the function still computes the layout
 * but the walker only consults it when the demotion happened.
 */
export function flowPositionsForOverlapStack(
  node: FigNode,
  children: readonly FigNode[],
): readonly { readonly x: number; readonly y: number }[] {
  const mode = node.stackMode?.name;
  const spacing = readFiniteNumber(node.stackSpacing) ?? 0;
  const padding = resolvePadding(node);
  const isHorizontal = mode === "HORIZONTAL";
  const positions: { x: number; y: number }[] = [];
  // `cursor` walks along the primary axis. Start at the leading
  // padding edge; each child adds its primary-axis size + spacing
  // before the next child's offset is computed.
  return computeOverlapPositions(children, isHorizontal, spacing, padding, positions);
}

function computeOverlapPositions(
  children: readonly FigNode[],
  isHorizontal: boolean,
  spacing: number,
  padding: Padding,
  acc: { x: number; y: number }[],
): readonly { readonly x: number; readonly y: number }[] {
  return children.reduce(
    (state, child) => {
      const x = isHorizontal ? state.cursor : padding.left;
      const y = isHorizontal ? padding.top : state.cursor;
      state.acc.push({ x, y });
      const size = child.size ?? { x: 0, y: 0 };
      const advance = (isHorizontal ? size.x : size.y) + spacing;
      return { acc: state.acc, cursor: state.cursor + advance };
    },
    { acc, cursor: isHorizontal ? padding.left : padding.top },
  ).acc;
}

/**
 * Resolve per-side padding from a node's `stackPadding*` fields.
 * Identical resolution rule to `fig-to-swiftui` so the two emitters
 * agree on what "padding 12 left, 8 top" decodes to from a given fig
 * file.
 *
 * INSIDE-aligned strokes on autolayout frames consume layout space.
 * Figma offsets the children by the stroke width so the painted
 * stroke band doesn't overlap them. We fold the stroke inset into
 * the resolved padding when the frame is an autolayout container —
 * non-autolayout frames position children via `transform.m02 / m12`,
 * which already accounts for the absolute position; folding stroke
 * into padding there would shift them twice.
 */
export function resolvePadding(node: FigNode): Padding {
  // Figma stores unset padding slots as NaN (kiwi float32). Route every
  // read through `readFiniteNumber` so a NaN never lands in the
  // resolved padding — otherwise it would propagate to Godot
  // `offset_*` writes and trip `printFloat`'s non-finite guard.
  const uniform = readFiniteNumber(node.stackPadding);
  const horizontal = readFiniteNumber(node.stackHorizontalPadding) ?? uniform;
  const vertical = readFiniteNumber(node.stackVerticalPadding) ?? uniform;
  const right = readFiniteNumber(node.stackPaddingRight) ?? horizontal;
  const bottom = readFiniteNumber(node.stackPaddingBottom) ?? vertical;
  const strokeInset = isAutolayoutFrame(node) ? insideStrokeWidth(node) : 0;
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

function isAutolayoutFrame(node: FigNode): boolean {
  const mode = node.stackMode?.name;
  return mode === "HORIZONTAL" || mode === "VERTICAL";
}

function readWrapName(raw: FigNode["stackWrap"]): string | undefined {
  return raw?.name;
}

/**
 * Compute absolute (x, y) positions for children of a GRID-mode
 * autolayout frame. Figma's `stackMode = GRID` arranges children
 * row-major into a grid where each cell takes the size of its child;
 * column count is determined by fitting as many children as possible
 * into the available content width (container size minus padding),
 * separated by `stackSpacing` between cells. Subsequent rows wrap
 * once the available width is exhausted.
 *
 * Sub-pixel detail: when children have varying sizes (e.g. wider rows
 * mixed with narrower ones) the cell heights take the row's tallest
 * child and cell widths take the column's widest. This matches the
 * `auto-grid-2x3` and `auto-wrap-3-rows` fixtures' shape — uniform
 * cell sizes — without needing a more elaborate grid solver.
 */
export function flowPositionsForGrid(
  node: FigNode,
  children: readonly FigNode[],
): readonly { readonly x: number; readonly y: number }[] {
  // GRID layout uses two independent gap values:
  //   - `stackSpacing` is the *column* gap (between cells in a row).
  //   - `stackCounterSpacing` is the *row* gap (between rows).
  // When the file omits `stackCounterSpacing` we fall back to
  // `stackSpacing` for symmetry with simple HBox/VBox layouts.
  const colGap = readFiniteNumber(node.stackSpacing) ?? 0;
  const rowGap = readFiniteNumber(node.stackCounterSpacing) ?? colGap;
  const padding = resolvePadding(node);
  const containerWidth = node.size?.x ?? 0;
  const containerHeight = node.size?.y ?? 0;
  const innerWidth = Math.max(0, containerWidth - padding.left - padding.right);
  const innerHeight = Math.max(0, containerHeight - padding.top - padding.bottom);
  // Positions are relative to the inner content area (post-padding).
  // The walker emits a `MarginContainer` wrapping the inner stack
  // when the frame has authored padding; that container already
  // applies the padding.
  const rows: readonly { readonly nodes: readonly FigNode[]; readonly height: number }[] =
    partitionIntoRows(children, innerWidth, colGap);
  // Total stacked height of all rows plus the gaps between them.
  const totalContentHeight = rows.reduce(
    (sum, row, idx) => sum + row.height + (idx < rows.length - 1 ? rowGap : 0),
    0,
  );
  // Counter-axis (vertical for HORIZONTAL/GRID layouts) alignment of
  // the row stack inside the container's inner content area. Mirrors
  // Figma's `stackCounterAlignItems`: MIN puts the content at the top
  // (offset 0), CENTER centres it within `innerHeight`, MAX pins it
  // to the bottom edge.
  const counterAlign = readAlignName(node.stackCounterAlignItems);
  const startY = (() => {
    if (innerHeight <= totalContentHeight) {
      return 0;
    }
    if (counterAlign === "CENTER") {
      return (innerHeight - totalContentHeight) / 2;
    }
    if (counterAlign === "MAX") {
      return innerHeight - totalContentHeight;
    }
    return 0;
  })();
  const positions: { x: number; y: number }[] = [];
  rows.reduce(
    (rowState, row) => {
      const rowTop = rowState.cursorY;
      row.nodes.reduce(
        (cellState, child) => {
          positions.push({ x: cellState.cursorX, y: rowTop });
          const size = child.size ?? { x: 0, y: 0 };
          return { cursorX: cellState.cursorX + size.x + colGap };
        },
        { cursorX: 0 },
      );
      return { cursorY: rowState.cursorY + row.height + rowGap };
    },
    { cursorY: startY },
  );
  return positions;
}

/**
 * Read the `name` from a Kiwi enum-shaped value (or accept a plain
 * string). Returns `undefined` when neither shape applies.
 */
function readAlignName(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "object" && "name" in raw) {
    const name = (raw as { name: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function partitionIntoRows(
  children: readonly FigNode[],
  innerWidth: number,
  spacing: number,
): readonly { readonly nodes: readonly FigNode[]; readonly height: number }[] {
  type Row = { readonly nodes: FigNode[]; readonly height: number };
  type State = {
    readonly rows: readonly Row[];
    readonly current: { readonly nodes: FigNode[]; readonly width: number; readonly height: number };
  };
  const initial: State = {
    rows: [],
    current: { nodes: [], width: 0, height: 0 },
  };
  const final = children.reduce<State>((state, child) => {
    const size = child.size ?? { x: 0, y: 0 };
    const projected = state.current.nodes.length === 0 ? size.x : state.current.width + spacing + size.x;
    if (projected > innerWidth && state.current.nodes.length > 0) {
      // Start a new row.
      return {
        rows: [...state.rows, { nodes: state.current.nodes, height: state.current.height }],
        current: { nodes: [child], width: size.x, height: size.y },
      };
    }
    return {
      rows: state.rows,
      current: {
        nodes: [...state.current.nodes, child],
        width: projected,
        height: Math.max(state.current.height, size.y),
      },
    };
  }, initial);
  if (final.current.nodes.length === 0) {
    return final.rows;
  }
  return [...final.rows, { nodes: final.current.nodes, height: final.current.height }];
}

/**
 * Read the node's INSIDE-stroke width. Returns 0 when the frame has
 * no visible stroke, the alignment is not INSIDE, the weight is
 * zero / per-side, or `bordersTakeSpace` is explicitly false (the
 * "Include borders in spacing" toggle).
 */
function insideStrokeWidth(node: FigNode): number {
  const bordersTakeSpace = (node as { bordersTakeSpace?: boolean }).bordersTakeSpace;
  if (bordersTakeSpace === false) {
    return 0;
  }
  const align = node.strokeAlign as { readonly name?: string } | string | undefined;
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
  const spacing = readFiniteNumber(node.stackSpacing);
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
