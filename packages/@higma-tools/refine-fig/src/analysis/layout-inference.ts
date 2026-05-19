/**
 * @file Auto-layout inference.
 *
 * Walks a FRAME's direct children and tries to recognise a uniform
 * single-axis stack (HORIZONTAL or VERTICAL). When it succeeds, emits
 * a `LayoutHint` carrying every field a `set-layout` PlanAction would
 * patch onto the parent: `stackMode`, `stackSpacing`, and per-side
 * padding plus the inferred cross-axis alignment.
 *
 * Fail-fast: no hint at all when the children fail any of these
 * gates. The point of the hint is to surface high-confidence cases
 * the agent then opts into via `decisions.layouts[guid] = { apply:
 * true }`. Adoption is never automatic.
 *
 * Gates (single-axis):
 *
 *   1. >= 2 visible direct children.
 *   2. Every child can be projected to a bounding rectangle (size +
 *      transform present).
 *   3. On the primary axis: rectangles are sortable (no meaningful
 *      overlap) and inter-child gaps are uniform within
 *      `GAP_TOLERANCE_PX` (absolute) OR within `GAP_TOLERANCE_RATIO`
 *      of the children's median primary-axis extent (relative — so a
 *      row of 200px-wide buttons tolerates a few px of jitter).
 *   4. On the cross axis: ALL children share one of three alignments
 *      — top/center/bottom (for HORIZONTAL) or left/center/right (for
 *      VERTICAL) — within `CROSS_AXIS_TOLERANCE_PX`. Children may
 *      have different cross-axis sizes; this is what auto-layout
 *      HUG/FILL/FIXED is for.
 *
 * The offset `(tx, ty)` is read from the child's `transform.m02
 * / m12`. Sizes from `size.x / y`. Both are required — children with
 * either missing field disqualify the parent (cannot reason about
 * their bounding box). When the transform exists and omits m02/m12,
 * those Kiwi fields read as 0.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";

const CROSS_AXIS_TOLERANCE_PX = 0.5;
const GAP_TOLERANCE_PX = 1;
const GAP_TOLERANCE_RATIO = 0.05;
const PADDING_TOLERANCE_PX = 1;

export type LayoutAxis = "HORIZONTAL" | "VERTICAL";

/**
 * Cross-axis alignment recognised by the inferrer. The four values
 * map directly onto Figma's `stackCounterAlignItems` enum:
 *
 *   MIN    — flush with the start of the cross axis (top for H, left for V)
 *   CENTER — centred
 *   MAX    — flush with the end of the cross axis
 *   STRETCH — every child's cross-axis extent equals the parent's
 *
 * The inferrer never emits STRETCH today; that needs container-vs-
 * child size comparison and is reserved for a later revision.
 */
export type CrossAxisAlign = "MIN" | "CENTER" | "MAX";

export type LayoutHint = {
  readonly nodeGuid: string;
  readonly layoutMode: LayoutAxis;
  readonly itemSpacing: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly counterAxisAlign: CrossAxisAlign;
  /**
   * Number of children that contributed to the inference, recorded so
   * the agent can sanity-check the gate matched at least the expected
   * count.
   */
  readonly childCount: number;
};

type RectChild = {
  readonly guid: string;
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
};

function readRect(node: FigNode): RectChild | undefined {
  const guid = node.guid;
  if (!guid) {
    return undefined;
  }
  const size = node.size;
  const transform = node.transform;
  if (!size || transform === undefined) {
    return undefined;
  }
  const tx = transform.m02 ?? 0;
  const ty = transform.m12 ?? 0;
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
    return undefined;
  }
  return {
    guid: `${guid.sessionID}:${guid.localID}`,
    tx,
    ty,
    width: size.x,
    height: size.y,
  };
}

function nearEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function maxGap(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((max, v) => (v > max ? v : max), values[0] ?? 0);
}

function minGap(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((min, v) => (v < min ? v : min), values[0] ?? 0);
}

/**
 * Compute inter-child gaps on the primary axis. Children must already
 * be sorted by primary-axis offset. Returns the gap list; emptiness
 * is a "single child" case the caller should have filtered.
 */
function gapsAlong(children: readonly RectChild[], axis: LayoutAxis): readonly number[] {
  return children.slice(1).map((child, idx) => {
    const prev = children[idx];
    if (!prev) {
      return Number.NaN;
    }
    if (axis === "HORIZONTAL") {
      return child.tx - (prev.tx + prev.width);
    }
    return child.ty - (prev.ty + prev.height);
  });
}

type AxisCheck =
  | { readonly ok: true; readonly itemSpacing: number; readonly counterAxisAlign: CrossAxisAlign }
  | { readonly ok: false };

/**
 * Try the three cross-axis alignments (MIN / CENTER / MAX). At least
 * one must hold for every child within `CROSS_AXIS_TOLERANCE_PX`.
 * Cross-axis size is NOT required to be equal — auto-layout's HUG/
 * FILL handles different sizes.
 */
function detectCrossAlign(
  rects: readonly RectChild[],
  axis: LayoutAxis,
): CrossAxisAlign | undefined {
  const first = rects[0];
  if (!first) {
    return undefined;
  }
  const refMin = axis === "HORIZONTAL" ? first.ty : first.tx;
  const refMax = axis === "HORIZONTAL" ? first.ty + first.height : first.tx + first.width;
  const refCenter = (refMin + refMax) / 2;
  const fits = (proj: (r: RectChild) => { min: number; max: number; center: number }, kind: CrossAxisAlign): boolean => {
    return rects.every((r) => {
      const p = proj(r);
      if (kind === "MIN") {
        return nearEqual(p.min, refMin, CROSS_AXIS_TOLERANCE_PX);
      }
      if (kind === "MAX") {
        return nearEqual(p.max, refMax, CROSS_AXIS_TOLERANCE_PX);
      }
      return nearEqual(p.center, refCenter, CROSS_AXIS_TOLERANCE_PX);
    });
  };
  const proj = (r: RectChild) => {
    if (axis === "HORIZONTAL") {
      return { min: r.ty, max: r.ty + r.height, center: r.ty + r.height / 2 };
    }
    return { min: r.tx, max: r.tx + r.width, center: r.tx + r.width / 2 };
  };
  if (fits(proj, "MIN")) {
    return "MIN";
  }
  if (fits(proj, "CENTER")) {
    return "CENTER";
  }
  if (fits(proj, "MAX")) {
    return "MAX";
  }
  return undefined;
}

function medianExtent(rects: readonly RectChild[], axis: LayoutAxis): number {
  const exts = rects.map((r) => (axis === "HORIZONTAL" ? r.width : r.height)).filter((x) => x > 0).sort((a, b) => a - b);
  if (exts.length === 0) {
    return 0;
  }
  const mid = Math.floor(exts.length / 2);
  return exts[mid] ?? 0;
}

function checkAxis(
  sorted: readonly RectChild[],
  axis: LayoutAxis,
): AxisCheck {
  const counterAxisAlign = detectCrossAlign(sorted, axis);
  if (!counterAxisAlign) {
    return { ok: false };
  }
  // Primary-axis ordering: no overlap means subsequent rect starts at
  // or after the prior rect's end (gap >= 0 within tolerance).
  const gaps = gapsAlong(sorted, axis);
  if (gaps.length === 0) {
    return { ok: false };
  }
  const minG = minGap(gaps);
  if (minG < -GAP_TOLERANCE_PX) {
    return { ok: false };
  }
  // Uniform-gap test, with both absolute and relative tolerance. A
  // row of 200px-wide buttons admits a few px of jitter; a row of
  // 8px-wide swatches does not.
  const maxG = maxGap(gaps);
  const median = medianExtent(sorted, axis);
  const tolerance = Math.max(GAP_TOLERANCE_PX, median * GAP_TOLERANCE_RATIO);
  if (maxG - minG > tolerance) {
    return { ok: false };
  }
  const meanGap = gaps.reduce((acc, g) => acc + g, 0) / gaps.length;
  const itemSpacing = Math.max(0, Math.round(meanGap));
  return { ok: true, itemSpacing, counterAxisAlign };
}

/**
 * Compute the four paddings honestly:
 *
 *   - Primary-axis padding (left/right for HORIZONTAL, top/bottom for
 *     VERTICAL) is parent_extent - last_child_end_on_primary.
 *   - Cross-axis padding depends on the detected alignment:
 *       MIN    → padTop / padLeft  = min(child.start),
 *                padBottom / padRight = parent - max(child.end)
 *       MAX    → symmetric flip
 *       CENTER → equal halves; padTop / padBottom = (parent - max_extent) / 2
 *
 * A negative inferred padding is the inferrer's signal that the
 * children stick outside the parent box — that means the FRAME's
 * `size` does not actually contain its content, so auto-layout would
 * silently move things. We refuse the hint in that case, tolerating
 * up to `PADDING_TOLERANCE_PX` of rounding noise.
 */
type CrossPadding = { readonly start: number; readonly end: number };

/**
 * Cross-axis padding depending on the detected alignment. For MIN the
 * shared edge is the start so padStart hugs that edge; padEnd is
 * "parent - max(child.end)". For MAX it's symmetric. For CENTER both
 * sides are equal halves of the remaining extent.
 */
function crossPaddingFor(
  align: CrossAxisAlign,
  minCross: number,
  maxCross: number,
  crossExt: number,
): CrossPadding {
  if (align === "MIN") {
    return { start: Math.round(minCross), end: Math.round(crossExt - maxCross) };
  }
  if (align === "MAX") {
    return { start: Math.round(crossExt - maxCross), end: Math.round(minCross) };
  }
  const half = Math.round((crossExt - (maxCross - minCross)) / 2);
  return { start: half, end: half };
}

function assembleResult(
  axis: LayoutAxis,
  primaryStartPad: number,
  primaryEndPad: number,
  cross: CrossPadding,
): { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number } {
  if (axis === "HORIZONTAL") {
    return {
      paddingLeft: primaryStartPad,
      paddingRight: primaryEndPad,
      paddingTop: cross.start,
      paddingBottom: cross.end,
    };
  }
  return {
    paddingLeft: cross.start,
    paddingRight: cross.end,
    paddingTop: primaryStartPad,
    paddingBottom: primaryEndPad,
  };
}

function paddingFor(
  parentSize: { readonly x: number; readonly y: number },
  sorted: readonly RectChild[],
  axis: LayoutAxis,
  align: CrossAxisAlign,
): { paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number } | undefined {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    return undefined;
  }
  const primaryStart = axis === "HORIZONTAL" ? first.tx : first.ty;
  const primaryEnd = axis === "HORIZONTAL" ? last.tx + last.width : last.ty + last.height;
  const primaryParent = axis === "HORIZONTAL" ? parentSize.x : parentSize.y;
  const primaryStartPad = Math.round(primaryStart);
  const primaryEndPad = Math.round(primaryParent - primaryEnd);

  const crossMins = sorted.map((r) => (axis === "HORIZONTAL" ? r.ty : r.tx));
  const crossMaxs = sorted.map((r) => (axis === "HORIZONTAL" ? r.ty + r.height : r.tx + r.width));
  const crossExt = axis === "HORIZONTAL" ? parentSize.y : parentSize.x;
  const minCross = Math.min(...crossMins);
  const maxCross = Math.max(...crossMaxs);
  const cross = crossPaddingFor(align, minCross, maxCross, crossExt);

  const result = assembleResult(axis, primaryStartPad, primaryEndPad, cross);
  const allOk = [result.paddingLeft, result.paddingRight, result.paddingTop, result.paddingBottom].every(
    (v) => v >= -PADDING_TOLERANCE_PX,
  );
  if (!allOk) {
    return undefined;
  }
  return {
    paddingLeft: Math.max(0, result.paddingLeft),
    paddingRight: Math.max(0, result.paddingRight),
    paddingTop: Math.max(0, result.paddingTop),
    paddingBottom: Math.max(0, result.paddingBottom),
  };
}

function layoutHintForAxis(
  frame: FigNode,
  sorted: readonly RectChild[],
  axis: LayoutAxis,
  axisResult: AxisCheck,
  childCount: number,
): LayoutHint | undefined {
  if (!axisResult.ok) {
    return undefined;
  }
  const size = frame.size;
  const guid = frame.guid;
  if (!size || !guid) {
    return undefined;
  }
  const padding = paddingFor(size, sorted, axis, axisResult.counterAxisAlign);
  if (!padding) {
    return undefined;
  }
  return {
    nodeGuid: `${guid.sessionID}:${guid.localID}`,
    layoutMode: axis,
    itemSpacing: axisResult.itemSpacing,
    ...padding,
    counterAxisAlign: axisResult.counterAxisAlign,
    childCount,
  };
}

/**
 * Try to infer an auto-layout for a single FRAME. Returns undefined
 * when no high-confidence inference is possible (the agent will see
 * no hint and the plan will not propose anything).
 */
export function inferLayoutForFrame(
  frame: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): LayoutHint | undefined {
  if (getNodeType(frame) !== "FRAME") {
    return undefined;
  }
  if (!frame.guid || !frame.size) {
    return undefined;
  }
  const rawChildren = childrenOf(frame);
  if (rawChildren.length < 2) {
    return undefined;
  }
  const children: RectChild[] = [];
  for (const child of rawChildren) {
    // Auto-layout is only meaningful for visible children — invisible
    // / detached overlay children disqualify the inference entirely
    // (we cannot tell whether to ignore them or honour them).
    if (child.visible === false) {
      return undefined;
    }
    const rect = readRect(child);
    if (!rect) {
      return undefined;
    }
    children.push(rect);
  }
  // Try horizontal first: sort by tx; then vertical: sort by ty.
  // Pick the axis whose check passes. Both passing is unusual (children
  // would all have to occupy a single point) — refuse the inference in
  // that case rather than silently picking one.
  const horizontalSorted = [...children].sort((a, b) => a.tx - b.tx);
  const verticalSorted = [...children].sort((a, b) => a.ty - b.ty);
  const horizontal = checkAxis(horizontalSorted, "HORIZONTAL");
  const vertical = checkAxis(verticalSorted, "VERTICAL");
  if (horizontal.ok && vertical.ok) {
    return undefined;
  }
  const horizontalHint = layoutHintForAxis(frame, horizontalSorted, "HORIZONTAL", horizontal, children.length);
  if (horizontalHint) {
    return horizontalHint;
  }
  const verticalHint = layoutHintForAxis(frame, verticalSorted, "VERTICAL", vertical, children.length);
  if (verticalHint) {
    return verticalHint;
  }
  return undefined;
}

/**
 * Walk every FRAME reachable from `roots` (incl. nested frames) and
 * collect every successful inference.
 */
export function inferLayouts(
  roots: readonly FigNode[],
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): readonly LayoutHint[] {
  const out: LayoutHint[] = [];
  for (const root of roots) {
    walk(root, out, childrenOf);
  }
  return out;
}

function walk(
  node: FigNode,
  out: LayoutHint[],
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): void {
  if (getNodeType(node) !== "FRAME") {
    walkChildren(node, out, childrenOf);
    return;
  }
  const hint = inferLayoutForFrame(node, childrenOf);
  if (hint) {
    out.push(hint);
  }
  walkChildren(node, out, childrenOf);
}

function walkChildren(
  node: FigNode,
  out: LayoutHint[],
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): void {
  for (const child of childrenOf(node)) {
    walk(child, out, childrenOf);
  }
}
