/**
 * @file Mechanical inference: detect when an absolutely-positioned
 * child set is shaped like an explicit auto-layout (stack, gap,
 * padding, alignment).
 *
 * Generalised version of fig-to-web's `emit/layout/infer-layout.ts`.
 * Works on any pair of (parent box, child boxes); both fig-to-web
 * (children = FigNode bounding boxes) and web-to-fig (children = DOM
 * absolutely-positioned descendants) plug in here. Conservative
 * inference: returns `none` whenever the pattern is ambiguous so the
 * caller can fall back to absolute positioning verbatim.
 */
import type { AutoLayoutIR, BoxIR } from "../ir/types";

/**
 * Tolerances reflect float32→float64 round-trip noise plus
 * designer-set values that pass through Figma's UI rounding. Values
 * are kept identical to the originals in
 * `@higma-tools/fig-to-web/src/emit/layout/infer-layout.ts` so the two
 * directions infer the same layout for the same geometry.
 */
const GAP_TOLERANCE = 1.5;
const ALIGN_TOLERANCE = 1.5;
const INSET_TOLERANCE = 1.5;
const MIN_CHILDREN_FOR_STACK = 2;

export type InferInput = {
  /** The parent's content box (size minus padding-known-up-front). For Web→Fig this is the element rect. */
  readonly parent: BoxIR;
  /**
   * Boxes of children that are eligible for the inference. Hidden / opted-out
   * children must be filtered before reaching this function.
   * Coordinates are in the *parent's* local frame (origin = parent's top-left).
   */
  readonly children: readonly BoxIR[];
};

/**
 * Inference result. `direction === "none"` means the caller should
 * keep the children as absolutely-positioned; the IR carries them as
 * `mode: "absolute"` ChildSizing entries.
 */
export type InferenceResult =
  | { readonly direction: "none" }
  | (AutoLayoutIR & {
      readonly direction: "row" | "column";
      readonly orderedIndices: readonly number[];
    });

/**
 * Try the row, column, and inset patterns in order and return the
 * first one that fits. The caller may inspect `direction === "none"`
 * to fall back to absolute positioning.
 */
export function inferAutoLayout(input: InferInput): InferenceResult {
  if (input.children.length === 0) {
    return { direction: "none" };
  }
  if (input.children.length === 1) {
    return inferInset(input);
  }
  if (input.children.length < MIN_CHILDREN_FOR_STACK) {
    return { direction: "none" };
  }
  const row = inferStack(input, "row");
  if (row.direction !== "none") {
    return row;
  }
  const column = inferStack(input, "column");
  if (column.direction !== "none") {
    return column;
  }
  return { direction: "none" };
}

function inferInset(input: InferInput): InferenceResult {
  const child = input.children[0]!;
  const top = child.y;
  const left = child.x;
  const right = input.parent.width - (child.x + child.width);
  const bottom = input.parent.height - (child.y + child.height);
  if (top < -INSET_TOLERANCE || left < -INSET_TOLERANCE
    || right < -INSET_TOLERANCE || bottom < -INSET_TOLERANCE) {
    return { direction: "none" };
  }
  // CSS `margin: 0 auto` is the canonical horizontal-symmetric
  // pattern: the child sits in the centre of the parent's width and
  // re-centres on resize. Translate that to `counterAlign=center`
  // with zero horizontal padding so the auto-layout container
  // re-centres the INSTANCE at any width. Vertical symmetry on the
  // web is never `margin-top: auto` — it's just `margin-top: <px>`
  // that happens to equal `margin-bottom: <px>` on the captured
  // viewport. Treating accidental vertical symmetry as a
  // primary=center signal would shift content vertically as soon as
  // an INSTANCE is taller than the symmetric configuration (the
  // first content row leaves the top edge), which is the opposite of
  // CSS's top-anchored flow. Always pin primary to `start` and keep
  // the literal `paddingTop` so the INSTANCE renders at the captured
  // top inset regardless of resize.
  const horizontalSymmetric = Math.abs(left - right) <= INSET_TOLERANCE && left > INSET_TOLERANCE;
  // Counter STRETCH: the child fills the parent's counter axis (zero
  // left/right inset within tolerance). Without this, a wrapper
  // `<body>` whose only child is a full-width `<div>` re-infers as
  // `counterAlign=start` with paddingLeft=paddingRight=0, and resizing
  // the wrapper shrinks the wrapper without touching the inner div —
  // the same clipping bug we saw with viewports being collapsed into
  // the SYMBOL. STRETCH lets the renderer's `applyCounterAxisStretch`
  // re-flow the child's counter dimension on every INSTANCE width.
  const horizontalStretch =
    Math.abs(left) <= INSET_TOLERANCE
    && Math.abs(right) <= INSET_TOLERANCE;
  // VERTICAL stack for single-child paragraph hosts. CSS web flow is
  // top-down: the inferred stack should let the child grow on the
  // horizontal axis (primary axis = vertical means counter axis =
  // horizontal). A counter STRETCH child then re-flows when the
  // INSTANCE width changes, which is what we need for responsive
  // verification.
  return {
    direction: "column",
    gap: 0,
    paddingTop: clampNonNeg(top),
    paddingRight: horizontalSymmetric ? 0 : clampNonNeg(right),
    paddingBottom: clampNonNeg(bottom),
    paddingLeft: horizontalSymmetric ? 0 : clampNonNeg(left),
    primaryAlign: "start",
    counterAlign: pickCounterAlign(horizontalStretch, horizontalSymmetric),
    orderedIndices: [0],
  };
}

function pickCounterAlign(stretch: boolean, symmetric: boolean): "stretch" | "center" | "start" {
  if (stretch) {
    return "stretch";
  }
  if (symmetric) {
    return "center";
  }
  return "start";
}

type Axis = "row" | "column";

function inferStack(input: InferInput, axis: Axis): InferenceResult {
  const indices = sortIndicesByAxis(input.children, axis);
  if (!nonOverlapping(input.children, indices, axis)) {
    return { direction: "none" };
  }
  const gap = uniformGap(input.children, indices, axis);
  if (gap === undefined) {
    return { direction: "none" };
  }
  const counter = inferCounterAlignment(input.parent, input.children, indices, axis);
  if (counter === undefined) {
    return { direction: "none" };
  }
  const padding = computePadding(input.parent, input.children, indices, axis);
  if (padding === undefined) {
    return { direction: "none" };
  }
  return {
    direction: axis,
    gap,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    primaryAlign: "start",
    counterAlign: counter,
    orderedIndices: indices,
  };
}

function sortIndicesByAxis(
  children: readonly BoxIR[],
  axis: Axis,
): readonly number[] {
  return children
    .map((_, i) => i)
    .sort((a, b) => {
      const da = axis === "row" ? children[a]!.x : children[a]!.y;
      const db = axis === "row" ? children[b]!.x : children[b]!.y;
      return da - db;
    });
}

function nonOverlapping(
  children: readonly BoxIR[],
  order: readonly number[],
  axis: Axis,
): boolean {
  for (let i = 1; i < order.length; i += 1) {
    const prev = children[order[i - 1]!]!;
    const cur = children[order[i]!]!;
    const prevEnd = axis === "row" ? prev.x + prev.width : prev.y + prev.height;
    const curStart = axis === "row" ? cur.x : cur.y;
    if (curStart + GAP_TOLERANCE < prevEnd) {
      return false;
    }
  }
  return true;
}

function uniformGap(
  children: readonly BoxIR[],
  order: readonly number[],
  axis: Axis,
): number | undefined {
  if (order.length < 2) {
    return 0;
  }
  const gaps: number[] = [];
  for (let i = 1; i < order.length; i += 1) {
    const prev = children[order[i - 1]!]!;
    const cur = children[order[i]!]!;
    const prevEnd = axis === "row" ? prev.x + prev.width : prev.y + prev.height;
    const curStart = axis === "row" ? cur.x : cur.y;
    gaps.push(curStart - prevEnd);
  }
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  if (max - min > GAP_TOLERANCE) {
    return undefined;
  }
  if (min < -GAP_TOLERANCE) {
    return undefined;
  }
  return Math.max(0, (min + max) / 2);
}

type CounterAlign = "start" | "center" | "end" | "stretch";

function inferCounterAlignment(
  parent: BoxIR,
  children: readonly BoxIR[],
  order: readonly number[],
  axis: Axis,
): CounterAlign | undefined {
  const starts = order.map((i) =>
    axis === "row" ? children[i]!.y : children[i]!.x,
  );
  const ends = order.map((i) => endOnCounterAxis(children[i]!, axis));
  const counterParent = axis === "row" ? parent.height : parent.width;

  // Stretch: every child fills the counter axis.
  const allStretch = order.every((i, k) => {
    const start = starts[k]!;
    const end = ends[k]!;
    const childCounter = axis === "row" ? children[i]!.height : children[i]!.width;
    return Math.abs(start) < ALIGN_TOLERANCE
      && Math.abs(end - counterParent) < ALIGN_TOLERANCE
      && childCounter > 0;
  });
  if (allStretch) {
    return "stretch";
  }

  // Start: every child shares a top/left edge.
  const minStart = Math.min(...starts);
  const allStart = starts.every((s) => Math.abs(s - minStart) < ALIGN_TOLERANCE);
  if (allStart) {
    return "start";
  }

  // End: every child shares a bottom/right edge.
  const maxEnd = Math.max(...ends);
  const allEnd = ends.every((e) => Math.abs(e - maxEnd) < ALIGN_TOLERANCE);
  if (allEnd) {
    return "end";
  }

  // Center: every child's centre is on the same line.
  const centres = starts.map((s, k) => (s + ends[k]!) / 2);
  const minCentre = Math.min(...centres);
  const maxCentre = Math.max(...centres);
  if (maxCentre - minCentre < ALIGN_TOLERANCE) {
    return "center";
  }
  return undefined;
}

type Padding = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

function computePadding(
  parent: BoxIR,
  children: readonly BoxIR[],
  order: readonly number[],
  axis: Axis,
): Padding | undefined {
  const first = children[order[0]!]!;
  const last = children[order[order.length - 1]!]!;
  const minTop = Math.min(...order.map((i) => children[i]!.y));
  const minLeft = Math.min(...order.map((i) => children[i]!.x));
  const maxBottom = Math.max(...order.map((i) => children[i]!.y + children[i]!.height));
  const maxRight = Math.max(...order.map((i) => children[i]!.x + children[i]!.width));

  if (axis === "row") {
    return resolvedPadding({
      top: minTop,
      right: parent.width - (last.x + last.width),
      bottom: parent.height - maxBottom,
      left: first.x,
    });
  }

  return resolvedPadding({
    top: first.y,
    right: parent.width - maxRight,
    bottom: parent.height - (last.y + last.height),
    left: minLeft,
  });
}

function resolvedPadding(padding: Padding): Padding | undefined {
  if (hasNegativeInset(padding)) {
    return undefined;
  }
  return {
    top: clampNonNeg(padding.top),
    right: clampNonNeg(padding.right),
    bottom: clampNonNeg(padding.bottom),
    left: clampNonNeg(padding.left),
  };
}

function hasNegativeInset(padding: Padding): boolean {
  return padding.left < -INSET_TOLERANCE
    || padding.right < -INSET_TOLERANCE
    || padding.top < -INSET_TOLERANCE
    || padding.bottom < -INSET_TOLERANCE;
}

function endOnCounterAxis(box: BoxIR, axis: Axis): number {
  if (axis === "row") {
    return box.y + box.height;
  }
  return box.x + box.width;
}

function clampNonNeg(n: number): number {
  if (n < 0 && n > -INSET_TOLERANCE) {
    return 0;
  }
  return Math.max(0, n);
}
