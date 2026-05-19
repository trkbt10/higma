/**
 * @file Mechanical inference: detect when an *absolute-positioned*
 * child set in a Figma frame is shaped like an explicit auto-layout
 * (stack along an axis, gap, padding, alignment) and translate it
 * into CSS flex semantics.
 *
 * Why: Figma authors commonly skip auto-layout for older frames or
 * imported designs, leaving everything as absolute coordinates. A
 * faithful generator that emits raw `position: absolute` for every
 * child reproduces the visual but leaves the developer with no
 * `padding` / `gap` / `flex` to maintain. The web idiom is to drive
 * spacing through padding/gap and direction through flex/grid;
 * relying on `position: absolute` everywhere is what designers'
 * tools generate, not what humans write.
 *
 * Inference is deliberately conservative — we only convert a frame
 * to flex when the pattern is unambiguous:
 *
 *   - **Vertical stack**: children sorted by Y are non-overlapping
 *     in Y, share a horizontal range or are consistently aligned
 *     (start / center / end), and their gaps along Y are equal
 *     within `GAP_TOLERANCE`.
 *
 *   - **Horizontal stack**: same pattern along X.
 *
 *   - **Single child**: one child, distance to each container edge
 *     is positive — express the four insets as `padding`.
 *
 * Failures (overlap, irregular gaps, mixed alignment, negative
 * insets) leave the frame's children as absolute; the visual is
 * preserved, just less idiomatic. Authors can always upgrade to
 * explicit auto-layout in Figma to opt in.
 *
 * The function is *pure* — no node mutation, no state. The output is
 * a small descriptor the JSX emitter consumes when computing the
 * frame's own style and when laying out its children.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { round2 } from "../../lib/css-format/numeric";

// Tolerances reflect float32→float64 round-trip noise plus designer-set
// values that pass through Figma's UI rounding. 0.5px was too tight in
// practice — gaps like 23.5/24.0/24.5 between three sibling cards
// (genuinely intended as a uniform 24px gap) failed inference and the
// frame fell back to absolute. 1.5px accommodates that noise without
// admitting visibly uneven layouts.
const GAP_TOLERANCE = 1.5;
const ALIGN_TOLERANCE = 1.5;
const INSET_TOLERANCE = 1.5;
const MIN_CHILDREN_FOR_STACK = 2;

export type InferredLayout = {
  readonly direction: "row" | "column";
  /** Children in flow order (axis-sorted). */
  readonly orderedChildren: readonly FigNode[];
  /** Equal gap between consecutive children along the axis. */
  readonly gap: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  /** Counter-axis alignment: how children align on the perpendicular axis. */
  readonly alignItems: "flex-start" | "center" | "flex-end" | "stretch";
};

export type InferredInset = {
  readonly direction: "inset";
  /** The single child the container wraps. */
  readonly child: FigNode;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
};

export type InferenceResult = InferredLayout | InferredInset | undefined;

/**
 * Children that opt out of layout via `stackPositioning: ABSOLUTE`
 * are not considered when inferring a flex stack. Splitting them up
 * front lets callers render them as positioned overlays inside an
 * inferred flex / inset container — matching how Figma renders them.
 */
export type SeparatedChildren = {
  readonly flow: readonly FigNode[];
  readonly absolute: readonly FigNode[];
};

/**
 * Partition a child list by `stackPositioning`. Children whose
 * positioning is `ABSOLUTE` are returned in `absolute`; the rest go
 * into `flow`. Mirrors how Figma's auto-layout treats absolute
 * children inside an auto-layout container — they participate in the
 * paint order but not in the stack flow.
 */
export function separateAbsoluteChildren(children: readonly FigNode[]): SeparatedChildren {
  const flow: FigNode[] = [];
  const absolute: FigNode[] = [];
  for (const child of children) {
    if (child.stackPositioning?.name === "ABSOLUTE") {
      absolute.push(child);
      continue;
    }
    flow.push(child);
  }
  return { flow, absolute };
}

type Box = {
  readonly node: FigNode;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

function nodeBox(node: FigNode): Box | undefined {
  if (!node.size) {
    return undefined;
  }
  const x = node.transform?.m02 ?? 0;
  const y = node.transform?.m12 ?? 0;
  const w = node.size.x;
  const h = node.size.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) {
    return undefined;
  }
  return { node, x, y, w, h };
}

function boxesOf(children: readonly FigNode[]): readonly Box[] {
  const out: Box[] = [];
  for (const child of children) {
    const box = nodeBox(child);
    if (box) {
      out.push(box);
    }
  }
  return out;
}

function approxEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function isVisible(node: FigNode): boolean {
  return node.visible !== false;
}

function hasExplicitAutoLayout(node: FigNode): boolean {
  const m = node.stackMode?.name;
  return m === "VERTICAL" || m === "HORIZONTAL";
}

/**
 * Try to infer flex semantics for the supplied frame. Returns
 * undefined when the frame should keep its absolute layout.
 *
 * Preconditions checked here:
 *   - the node carries no explicit auto-layout (we do not second-
 *     guess Figma's authoring),
 *   - it has a usable `size`,
 *   - it has at least one rendered child with a usable transform.
 *
 * `childrenOverride` lets the caller restrict the candidate children
 * (e.g. after `decoration.absorbBackgroundDecoration` removes the
 * full-bleed background layer). When omitted, every visible direct
 * child of `frame` is considered.
 *
 * A frame with an explicit `clipsContent: false` would normally allow
 * children to extend beyond its bounds — but in practice that is
 * also the most common authoring shape for "loose layout" containers
 * we still want to translate to flex. Honour the inferred layout
 * regardless of clipping; the visual stays the same when children
 * stay inside their parent's box (which is the case under the
 * inset-tolerance check anyway).
 */
export function inferLayout(frame: FigNode, candidateChildren: readonly FigNode[]): InferenceResult {
  if (hasExplicitAutoLayout(frame)) {
    return undefined;
  }
  if (!frame.size) {
    return undefined;
  }
  const allChildren = candidateChildren.filter(isVisible);
  if (allChildren.length === 0) {
    return undefined;
  }
  // Children with `stackPositioning: ABSOLUTE` opt out of the stack
  // and must not skew gap / alignment math. Filter them before
  // measuring; the caller is expected to render them as positioned
  // overlays inside the inferred flex container (matching Figma's
  // own rendering of "absolute inside auto-layout").
  const flowChildren = allChildren.filter((child) => child.stackPositioning?.name !== "ABSOLUTE");
  if (flowChildren.length === 0) {
    return undefined;
  }
  const boxes = boxesOf(flowChildren);
  if (boxes.length !== flowChildren.length) {
    return undefined;
  }
  const containerW = frame.size.x;
  const containerH = frame.size.y;

  // All children must lie within the container (within tolerance).
  for (const box of boxes) {
    if (box.x < -INSET_TOLERANCE || box.y < -INSET_TOLERANCE) {
      return undefined;
    }
    if (box.x + box.w > containerW + INSET_TOLERANCE) {
      return undefined;
    }
    if (box.y + box.h > containerH + INSET_TOLERANCE) {
      return undefined;
    }
  }

  if (boxes.length === 1) {
    return inferInset(boxes[0]!, containerW, containerH);
  }
  if (boxes.length < MIN_CHILDREN_FOR_STACK) {
    return undefined;
  }

  const column = inferStack(boxes, "column", containerW, containerH);
  if (column) {
    return column;
  }
  const row = inferStack(boxes, "row", containerW, containerH);
  if (row) {
    return row;
  }
  return undefined;
}

function inferInset(box: Box, containerW: number, containerH: number): InferredInset {
  // Clamp to non-negative — browsers ignore negative padding and the
  // emitter rendering `padding: -1px` produces an off-by-1 shift on
  // any frame whose authored child slightly overflows the container.
  // The original absolute fallback used `top: -1px` which IS honoured;
  // padding's clamp-to-zero is not. Refuse to surface negative insets
  // here so the layout remains visually faithful.
  const paddingLeft = Math.max(0, round2(box.x));
  const paddingTop = Math.max(0, round2(box.y));
  const paddingRight = Math.max(0, round2(containerW - (box.x + box.w)));
  const paddingBottom = Math.max(0, round2(containerH - (box.y + box.h)));
  return {
    direction: "inset",
    child: box.node,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
  };
}

function inferStack(
  boxes: readonly Box[],
  direction: "row" | "column",
  containerW: number,
  containerH: number,
): InferredLayout | undefined {
  const isColumn = direction === "column";
  const sorted = [...boxes].sort((a, b) => (isColumn ? a.y - b.y : a.x - b.x));

  // Non-overlap on primary axis.
  for (let i = 1; i < sorted.length; i = i + 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) {
      return undefined;
    }
    const prevEnd = isColumn ? prev.y + prev.h : prev.x + prev.w;
    const currStart = isColumn ? curr.y : curr.x;
    if (currStart < prevEnd - GAP_TOLERANCE) {
      return undefined;
    }
  }

  // Equal gaps along primary axis.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i = i + 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) {
      return undefined;
    }
    const prevEnd = isColumn ? prev.y + prev.h : prev.x + prev.w;
    const currStart = isColumn ? curr.y : curr.x;
    gaps.push(currStart - prevEnd);
  }
  if (!allWithin(gaps, GAP_TOLERANCE)) {
    return undefined;
  }
  const gap = gaps.length === 0 ? 0 : round2(gaps[0] ?? 0);
  if (gap < 0) {
    return undefined;
  }

  // Counter-axis alignment must be uniform across children.
  const alignItems = inferCounterAlign(sorted, direction, isColumn ? containerW : containerH);
  if (!alignItems) {
    return undefined;
  }

  // Padding: distance from the container's edges to the child cluster's
  // bounding box.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    return undefined;
  }
  const minPrimary = isColumn ? first.y : first.x;
  const maxPrimary = isColumn ? last.y + last.h : last.x + last.w;
  const minCounter = Math.min(...sorted.map((b) => (isColumn ? b.x : b.y)));
  const maxCounter = Math.max(...sorted.map((b) => (isColumn ? b.x + b.w : b.y + b.h)));

  const paddingTop = round2(isColumn ? minPrimary : minCounter);
  const paddingBottom = round2(isColumn ? containerH - maxPrimary : containerH - maxCounter);
  const paddingLeft = round2(isColumn ? minCounter : minPrimary);
  const paddingRight = round2(isColumn ? containerW - maxCounter : containerW - maxPrimary);

  if (paddingTop < -INSET_TOLERANCE) {
    return undefined;
  }
  if (paddingBottom < -INSET_TOLERANCE) {
    return undefined;
  }
  if (paddingLeft < -INSET_TOLERANCE) {
    return undefined;
  }
  if (paddingRight < -INSET_TOLERANCE) {
    return undefined;
  }

  return {
    direction,
    orderedChildren: sorted.map((b) => b.node),
    gap,
    paddingTop: Math.max(0, paddingTop),
    paddingRight: Math.max(0, paddingRight),
    paddingBottom: Math.max(0, paddingBottom),
    paddingLeft: Math.max(0, paddingLeft),
    alignItems,
  };
}

/**
 * Infer the alignment of children on the counter axis.
 *
 * Three signals — start, end, centre — must each be consistent across
 * every child to qualify. "Stretch" requires all children to have
 * identical counter-axis size matching the container's content
 * area, which we approximate as "all children fill the available
 * counter dimension". Any mismatch returns undefined: the heuristic
 * declines rather than guess.
 */
function inferCounterAlign(
  boxes: readonly Box[],
  direction: "row" | "column",
  containerCounterDim: number,
): "flex-start" | "center" | "flex-end" | "stretch" | undefined {
  const isColumn = direction === "column";
  const counters = boxes.map((b) => ({
    start: isColumn ? b.x : b.y,
    end: isColumn ? b.x + b.w : b.y + b.h,
    size: isColumn ? b.w : b.h,
  }));

  if (counters.every((c) => approxEqual(c.size, containerCounterDim, INSET_TOLERANCE))) {
    return "stretch";
  }

  const allStartEqual = counters.every((c, _, arr) => arr[0] !== undefined && approxEqual(c.start, arr[0].start, ALIGN_TOLERANCE));
  if (allStartEqual) {
    return "flex-start";
  }

  const allEndEqual = counters.every((c, _, arr) => arr[0] !== undefined && approxEqual(c.end, arr[0].end, ALIGN_TOLERANCE));
  if (allEndEqual) {
    return "flex-end";
  }

  const allCentreEqual = counters.every((c, _, arr) => {
    const first = arr[0];
    if (!first) {
      return false;
    }
    return approxEqual((c.start + c.end) / 2, (first.start + first.end) / 2, ALIGN_TOLERANCE);
  });
  if (allCentreEqual) {
    return "center";
  }

  return undefined;
}

function allWithin(values: readonly number[], tolerance: number): boolean {
  if (values.length === 0) {
    return true;
  }
  const ref = values[0] ?? 0;
  for (const v of values) {
    if (!approxEqual(v, ref, tolerance)) {
      return false;
    }
  }
  return true;
}
