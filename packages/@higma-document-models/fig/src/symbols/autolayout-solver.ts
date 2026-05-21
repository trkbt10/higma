/**
 * @file Figma autolayout solver — primary axis, counter axis, wrap, grid.
 *
 * SymbolResolver uses `resolveAutoLayoutFrame(parent, children)` while
 * materialising an INSTANCE. It dispatches on the Kiwi `stackMode` field:
 *
 *   - GRID                       → `applyGridLayout`
 *   - HORIZONTAL / VERTICAL + stackWrap=WRAP → `applyWrapLayout`
 *   - HORIZONTAL / VERTICAL              → `applyAutoLayoutPrimaryAxis`
 *                                          then `applyCounterAxisPosition`
 *   - NONE / unset               → noop (with aspect-lock verification)
 *
 * Boundary:
 *
 *   Raw Kiwi document FRAME / SYMBOL descendants are already authored
 *   document state and must not be recomputed by renderers. This solver
 *   belongs to INSTANCE materialisation: after SymbolResolver has selected
 *   a SYMBOL, applied overrides, and merged resized-instance constraints,
 *   stack layout fields can still describe the resolved INSTANCE's own
 *   materialised children. Keeping that step inside SymbolResolver prevents
 *   renderers from becoming a second source of SYMBOL resolution truth.
 *
 * Scope of the primary-axis core (`applyAutoLayoutPrimaryAxis`):
 *
 *   - stackPrimaryAlignItems: MIN, CENTER, MAX, SPACE_BETWEEN,
 *     SPACE_EVENLY, SPACE_AROUND (the values the schema allows for
 *     `StackJustify`)
 *   - stackChildPrimaryGrow: per-child grow factor (FILL behaviour)
 *   - per-side stackPadding
 *
 * Always honoured:
 *
 *   - absolutely-positioned (stackPositioning=ABSOLUTE) children keep
 *     their authored transform
 *   - rotated children are placed by their AABB top-left, not their
 *     local origin (so 90° / 180° / 270° rotations don't drift)
 *
 * Counter-axis stretch (one child's cross-axis dimension expanding to
 * fill the parent) is resolved here from the same raw stack fields.
 * Renderers may consume `resolveAuthoredAutoLayoutFrameStretch` for raw
 * document FRAME / SYMBOL descendants: it projects the stretch dimension
 * without replaying primary-axis or counter-axis positioning, so authored
 * Kiwi transforms remain the source of truth.
 */

import { computeFlexShare, interpretGridTrackSize, resolveTrackSize } from "./grid-track-size";

export type PrimaryAxisParent = {
  readonly size?: { readonly x: number; readonly y: number };
  readonly strokeWeight?: number | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly individualStrokeWeights?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly proportionsConstrained?: boolean;
  readonly minSize?: { readonly x: number; readonly y: number };
  readonly maxSize?: { readonly x: number; readonly y: number };
  readonly bordersTakeSpace?: boolean;
  readonly targetAspectRatio?: { readonly x: number; readonly y: number };
  readonly gridRows?: { readonly entries: readonly unknown[] };
  readonly gridColumns?: { readonly entries: readonly unknown[] };
  readonly gridColumnsSizing?: { readonly entries: readonly { readonly trackSize?: unknown }[] };
  readonly gridRowsSizing?: { readonly entries: readonly { readonly trackSize?: unknown }[] };
  readonly gridRowGap?: number;
  readonly gridColumnGap?: number;
  readonly stackMode?: { readonly name?: string };
  readonly stackPadding?: number;
  readonly stackVerticalPadding?: number;
  readonly stackHorizontalPadding?: number;
  readonly stackPaddingRight?: number;
  readonly stackPaddingBottom?: number;
  readonly stackSpacing?: number;
  readonly stackCounterSpacing?: number;
  readonly stackCounterAlignItems?: { readonly name?: string };
  readonly stackPrimaryAlignItems?: { readonly name?: string };
  readonly stackPrimaryAlignContent?: { readonly name?: string };
  readonly stackWrap?: { readonly name?: string };
  readonly stackReverseZIndex?: boolean;
  readonly stackPrimarySizing?: { readonly name?: string };
  readonly stackCounterSizing?: { readonly name?: string };
};

export type PrimaryAxisChild = {
  readonly size?: { readonly x: number; readonly y: number };
  readonly transform?: {
    readonly m00: number; readonly m01: number; readonly m02: number;
    readonly m10: number; readonly m11: number; readonly m12: number;
  };
  readonly visible?: boolean;
  readonly stackPositioning?: { readonly name?: string };
  readonly stackChildPrimaryGrow?: number;
  readonly stackChildAlignSelf?: { readonly name?: string };
  readonly gridChildHorizontalAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH";
  readonly gridChildVerticalAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH";
  readonly gridColumnSpan?: number;
  readonly gridRowSpan?: number;
};

export type AutoLayoutResolution<C extends PrimaryAxisChild, P extends PrimaryAxisParent> = {
  readonly parent: P;
  readonly children: readonly C[];
};

function readStackPadding(parent: PrimaryAxisParent): { top: number; right: number; bottom: number; left: number } {
  const uniform = parent.stackPadding ?? 0;
  const vertical = parent.stackVerticalPadding ?? uniform;
  const horizontal = parent.stackHorizontalPadding ?? uniform;
  return {
    top: vertical,
    right: parent.stackPaddingRight ?? horizontal,
    bottom: parent.stackPaddingBottom ?? vertical,
    left: horizontal,
  };
}

/**
 * Compute a child's axis-aligned bounding box (AABB) in its parent's
 * coordinate space, taking the child's full affine transform into
 * account. For rotated children the local origin is no longer the
 * AABB top-left, so the auto-layout solver must reason about the AABB
 * (which is what the user perceives as the child's "position and
 * size on screen") rather than the raw `transform.m02 / m12 / size`
 * values. The non-rotated case collapses to `(m02, m12)` /
 * `(m02 + size.x, m12 + size.y)` exactly.
 */
function childAabb(child: PrimaryAxisChild): {
  readonly min: { readonly x: number; readonly y: number };
  readonly max: { readonly x: number; readonly y: number };
} | undefined {
  if (!child.size) { return undefined; }
  const t = child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const { x: w, y: h } = child.size;
  // Iterate over the 4 corners of the local rect [0,0]-[w,h], project
  // each into parent space, and take min/max along both axes.
  const corners: ReadonlyArray<readonly [number, number]> = [
    [0, 0], [w, 0], [0, h], [w, h],
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [cx, cy] of corners) {
    const px = t.m00 * cx + t.m01 * cy + t.m02;
    const py = t.m10 * cx + t.m11 * cy + t.m12;
    if (px < minX) { minX = px; }
    if (py < minY) { minY = py; }
    if (px > maxX) { maxX = px; }
    if (py > maxY) { maxY = py; }
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

function resizePrimaryAxisIfChanged(
  size: { readonly x: number; readonly y: number } | undefined,
  newSizeAxis: number,
  horizontal: boolean,
): { readonly x: number; readonly y: number } | undefined {
  if (!size) { return undefined; }
  if (horizontal && Math.abs(size.x - newSizeAxis) <= 0.5) { return size; }
  if (horizontal) {
    return { x: newSizeAxis, y: size.y };
  }
  if (Math.abs(size.y - newSizeAxis) <= 0.5) { return size; }
  return { x: size.x, y: newSizeAxis };
}

function resizeAxis(
  size: { readonly x: number; readonly y: number },
  axis: "x" | "y",
  value: number,
): { readonly x: number; readonly y: number } {
  if (axis === "x" && Math.abs(size.x - value) <= 0.5) { return size; }
  if (axis === "x") {
    return { x: value, y: size.y };
  }
  if (Math.abs(size.y - value) <= 0.5) { return size; }
  return { x: size.x, y: value };
}

function projectedAxisSpan(child: PrimaryAxisChild, axis: "x" | "y"): number {
  if (!child.size) {
    throw new Error("AutoLayout projectedAxisSpan requires child size.");
  }
  const aabb = childAabb(child);
  if (!aabb) {
    return axisSize(child.size, axis);
  }
  if (axis === "x") {
    return aabb.max.x - aabb.min.x;
  }
  return aabb.max.y - aabb.min.y;
}

function resizePrimarySizeForPlacedChild<C extends PrimaryAxisChild>(
  original: C,
  oldT: NonNullable<PrimaryAxisChild["transform"]>,
  primarySize: number,
  horizontal: boolean,
): { readonly x: number; readonly y: number } | undefined {
  const childIsAxisAligned = oldT.m01 === 0 && oldT.m10 === 0 && oldT.m00 === 1 && oldT.m11 === 1;
  if (!childIsAxisAligned) {
    return original.size;
  }
  return resizePrimaryAxisIfChanged(original.size, primarySize, horizontal);
}

function resizeBothAxesIfChanged(
  size: { readonly x: number; readonly y: number },
  next: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  if (Math.abs(size.x - next.x) <= 0.5 && Math.abs(size.y - next.y) <= 0.5) {
    return size;
  }
  return next;
}

function clampAxis(value: number, axis: "x" | "y", parent: PrimaryAxisParent): number {
  const min = axis === "x" ? parent.minSize?.x : parent.minSize?.y;
  const max = axis === "x" ? parent.maxSize?.x : parent.maxSize?.y;
  if (min !== undefined && value < min) { return min; }
  if (max !== undefined && value > max) { return max; }
  return value;
}

function readStrokeInsets(parent: PrimaryAxisParent): { top: number; right: number; bottom: number; left: number } {
  if (parent.bordersTakeSpace !== true) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (parent.individualStrokeWeights) {
    return parent.individualStrokeWeights;
  }
  const raw = parent.strokeWeight;
  if (typeof raw === "number") {
    return { top: raw, right: raw, bottom: raw, left: raw };
  }
  if (raw && typeof raw === "object") {
    return raw;
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function contentInsets(parent: PrimaryAxisParent): { top: number; right: number; bottom: number; left: number } {
  const padding = readStackPadding(parent);
  const stroke = readStrokeInsets(parent);
  return {
    top: padding.top + stroke.top,
    right: padding.right + stroke.right,
    bottom: padding.bottom + stroke.bottom,
    left: padding.left + stroke.left,
  };
}

function primaryAxis(horizontal: boolean): "x" | "y" {
  return horizontal ? "x" : "y";
}

function counterAxis(horizontal: boolean): "x" | "y" {
  return horizontal ? "y" : "x";
}

function axisSize(size: { readonly x: number; readonly y: number }, axis: "x" | "y"): number {
  return axis === "x" ? size.x : size.y;
}

function isFlowChild(child: PrimaryAxisChild): boolean {
  if (child.visible === false) { return false; }
  if (child.stackPositioning?.name === "ABSOLUTE") { return false; }
  return child.size !== undefined;
}

function stackWrapEnabled(value: { readonly name?: string } | undefined): boolean {
  return value?.name === "WRAP";
}

function resolveStartOffset(
  align: string | undefined,
  contentSpan: number,
  blockSpan: number,
  insetStart: number,
): number {
  switch (align) {
    case "CENTER":
      return insetStart + (contentSpan - blockSpan) / 2;
    case "MAX":
      return insetStart + (contentSpan - blockSpan);
    case "MIN":
    case undefined:
    default:
      return insetStart;
  }
}

/**
 * Cross-check the parent's `proportionsConstrained` / `targetAspectRatio`
 * pair against its `size`. Returns the parent unchanged in every
 * successful path — this is a verification gate, not a layout transform.
 *
 * Figma's schema declares `proportionsConstrained` (bool) and
 * `targetAspectRatio` (vector) as independent optional fields. The
 * authoring contract is:
 *
 *   - `proportionsConstrained=true` alone → "lock to the current
 *     size's ratio". There is no separate target; `size.x:size.y` *is*
 *     the locked ratio, so validating it against itself is a tautology.
 *     Real Figma exports (e.g. icon INSTANCEs from the E-commerce and
 *     Windows 98 community templates) ship this shape verbatim.
 *
 *   - `proportionsConstrained=true` plus an explicit
 *     `targetAspectRatio` → "lock to this explicit ratio". When both
 *     fields are present we verify they agree with `size`; a divergence
     *     means our pipeline (parser / SYMBOL resize / override application)
 *     produced a node whose stored ratio doesn't match its stored size,
 *     which IS a real inconsistency.
 *
 * Missing `targetAspectRatio` therefore must NOT throw. The previous
 * gate required it unconditionally, which crashed the editor on any
 * file containing an aspect-locked INSTANCE without an authored target.
 */
function applyAspectLock<P extends PrimaryAxisParent>(parent: P): P {
  if (parent.proportionsConstrained !== true) { return parent; }
  const target = parent.targetAspectRatio;
  if (!target) { return parent; }
  if (!parent.size) {
    throw new Error("AutoLayout aspect lock requires parent size.");
  }
  if (parent.size.y === 0 || target.y === 0) {
    throw new Error(
      `AutoLayout aspect lock degenerate: size ${parent.size.x}x${parent.size.y}, target ${target.x}:${target.y}.`,
    );
  }
  const expected = target.x / target.y;
  const actual = parent.size.x / parent.size.y;
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`AutoLayout aspect lock mismatch: size ${parent.size.x}x${parent.size.y} does not match ${target.x}:${target.y}.`);
  }
  return parent;
}

function applyHugSizing<P extends PrimaryAxisParent, C extends PrimaryAxisChild>(
  parent: P,
  flow: readonly C[],
  horizontal: boolean,
): P {
  if (!parent.size) {
    throw new Error("AutoLayout sizing requires parent size.");
  }
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL" && modeName !== "GRID") { return parent; }
  const insets = contentInsets(parent);
  const pAxis = primaryAxis(horizontal);
  const cAxis = counterAxis(horizontal);
  const pStart = horizontal ? insets.left : insets.top;
  const pEnd = horizontal ? insets.right : insets.bottom;
  const cStart = horizontal ? insets.top : insets.left;
  const cEnd = horizontal ? insets.bottom : insets.right;
  const spacing = parent.stackSpacing ?? 0;
  const primaryHug = parent.stackPrimarySizing?.name === "RESIZE_TO_FIT";
  const counterHug = parent.stackCounterSizing?.name === "RESIZE_TO_FIT";
  if (!primaryHug && !counterHug) { return parent; }

  const primaryContent = computePrimaryContent(parent, flow, modeName, pAxis, spacing);
  const counterContent = computeCounterContent(parent, flow, modeName, cAxis);

  const nextPrimary = primaryHug ? clampAxis(primaryContent + pStart + pEnd, pAxis, parent) : axisSize(parent.size, pAxis);
  const nextCounter = counterHug ? clampAxis(counterContent + cStart + cEnd, cAxis, parent) : axisSize(parent.size, cAxis);
  const nextSize = horizontal ? { x: nextPrimary, y: nextCounter } : { x: nextCounter, y: nextPrimary };
  const resized = resizeBothAxesIfChanged(parent.size, nextSize);
  if (resized === parent.size) { return parent; }
  return { ...parent, size: resized };
}

function computePrimaryContent<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  flow: readonly C[],
  modeName: string,
  pAxis: "x" | "y",
  spacing: number,
): number {
  if (modeName === "GRID") {
    const cols = readGridColumns(parent, flow.length);
    const widths = Array.from({ length: cols }, (_, col) => {
      const columnChildren = flow.filter((_, index) => index % cols === col);
      return columnChildren.reduce((max, child) => Math.max(max, axisSize(child.size!, pAxis)), 0);
    });
    return widths.reduce((sum, value) => sum + value, 0) + spacing * Math.max(0, cols - 1);
  }
  return flow.reduce((sum, child) => sum + axisSize(child.size!, pAxis), 0) + spacing * Math.max(0, flow.length - 1);
}

function computeCounterContent<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  flow: readonly C[],
  modeName: string,
  cAxis: "x" | "y",
): number {
  if (modeName === "GRID") {
    const cols = readGridColumns(parent, flow.length);
    const rows = Math.ceil(flow.length / cols);
    const rowGap = parent.stackCounterSpacing ?? 0;
    const heights = Array.from({ length: rows }, (_, row) => {
      const rowChildren = flow.slice(row * cols, row * cols + cols);
      return rowChildren.reduce((max, child) => Math.max(max, axisSize(child.size!, cAxis)), 0);
    });
    return heights.reduce((sum, value) => sum + value, 0) + rowGap * Math.max(0, rows - 1);
  }
  return flow.reduce((max, child) => Math.max(max, axisSize(child.size!, cAxis)), 0);
}

function readGridColumns(parent: PrimaryAxisParent, childCount: number): number {
  const gridColumns = parent.gridColumns;
  if (gridColumns !== undefined && gridColumns.entries.length > 0) {
    return gridColumns.entries.length;
  }
  const content = parent.stackPrimaryAlignContent?.name;
  if (content === "CENTER" && childCount > 0) {
    return Math.ceil(Math.sqrt(childCount));
  }
  throw new Error("GRID AutoLayout requires explicit grid column metadata.");
}

/**
 * Distribute the children's positions along the parent's primary axis.
 *
 * Returns a new children array with each (visible, non-absolute) child
 * having its transform translated to the computed primary-axis offset.
 * Counter-axis position is preserved from the input child.
 *
 * `resolveAutoLayoutFrame` applies counter-axis stretch before calling
 * this function, so each child's `size` is already correct on the
 * counter axis when relevant.
 */
export function applyAutoLayoutPrimaryAxis<C extends PrimaryAxisChild>(parent: PrimaryAxisParent, children: readonly C[]): readonly C[] {
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") {return children;}
  const pSize = parent.size;
  if (!pSize) {return children;}

  const horizontal = modeName === "HORIZONTAL";
  const insets = contentInsets(parent);
  const padPrimaryStart = horizontal ? insets.left : insets.top;
  const padPrimaryEnd = horizontal ? insets.right : insets.bottom;
  const primaryParent = horizontal ? pSize.x : pSize.y;
  const contentSpan = primaryParent - padPrimaryStart - padPrimaryEnd;
  if (contentSpan <= 0) {return children;}

  // Filter to layout-participating children (visible + non-absolute).
  // The primary-axis size we sum here is the AABB projection, not the
  // local size: a 90°-rotated 36×54 child contributes 54 along its
  // parent's HORIZONTAL axis, and a 180°-rotated child still
  // contributes 36 (the AABB unchanged) but its `m02 / m12` are no
  // longer the AABB top-left — placement later compensates.
  type Idx = { idx: number; child: C; primarySize: number; aabbOriginOffset: number };
  const flow: Idx[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.visible === false) {continue;}
    const pos = c.stackPositioning?.name;
    if (pos === "ABSOLUTE") {continue;}
    if (!c.size) {continue;}
    const primarySize = projectedAxisSpan(c, horizontal ? "x" : "y");
    // `aabbOriginOffset` = (current local origin) − (current AABB
    // min) along the primary axis. For unrotated children this is 0
    // (origin == AABB top-left); for rotated children it captures
    // how far the local origin sits inside / past the AABB so the
    // post-layout `m02 / m12` can be reconstructed by adding this
    // offset to the cursor.
    const originPos = horizontal ? (c.transform?.m02 ?? 0) : (c.transform?.m12 ?? 0);
    const aabb = childAabb(c);
    const aabbMin = aabb ? (horizontal ? aabb.min.x : aabb.min.y) : originPos;
    flow.push({ idx: i, child: c, primarySize, aabbOriginOffset: originPos - aabbMin });
  }
  if (flow.length === 0) {return children;}

  // Apply FILL grow first: any child with stackChildPrimaryGrow=1 takes
  // the leftover space after fixed children + spacing. We split the
  // leftover evenly among grow children.
  const spacing = parent.stackSpacing ?? 0;
  const align = parent.stackPrimaryAlignItems?.name;
  const isJustifySpace = align === "SPACE_BETWEEN" || align === "SPACE_EVENLY" || align === "SPACE_AROUND";

  const fixedSizeSum = flow.reduce((s, e) => s + e.primarySize, 0);
  const growChildren = flow.filter((e) => (e.child.stackChildPrimaryGrow ?? 0) > 0);
  const totalSpacing = spacing * (flow.length - 1);
  const free = contentSpan - fixedSizeSum - totalSpacing;
  if (growChildren.length > 0 && !isJustifySpace && free > 0) {
    const perGrow = free / growChildren.length;
    for (const g of growChildren) {
      g.primarySize = g.primarySize + perGrow;
    }
  }

  // Compute starting offset and inter-item gap based on alignment.
  const flowSizeSum = flow.reduce((s, e) => s + e.primarySize, 0);
  let startOffset: number;
  let gap = spacing;
  switch (align) {
    case "CENTER": {
      const usedSpacing = spacing * (flow.length - 1);
      const blockSize = flowSizeSum + usedSpacing;
      startOffset = padPrimaryStart + (contentSpan - blockSize) / 2;
      break;
    }
    case "MAX": {
      const usedSpacing = spacing * (flow.length - 1);
      const blockSize = flowSizeSum + usedSpacing;
      startOffset = padPrimaryStart + (contentSpan - blockSize);
      break;
    }
    case "SPACE_BETWEEN":
    case "SPACE_EVENLY": {
      // Figma's `SPACE_EVENLY` enum value (StackJustify=3) is paired
      // with what the UI labels "Space between": children flush to
      // both inner edges with the leftover distributed in the (n-1)
      // gaps between them. The previous CSS-style implementation
      // (equal gaps including edges) shifted every leading child
      // inward, which surfaced in real fig fixtures as headers
      // appearing to grow wider L/R margins and instance logos
      // drifting right of their authored origin. The fig-to-web CSS
      // emitter already collapses both names to `space-between`; this
      // branch keeps the scene graph aligned with that authored
      // interpretation. Single child collapses to MIN.
      if (flow.length > 1) {
        const free = contentSpan - flowSizeSum;
        gap = free / (flow.length - 1);
      }
      startOffset = padPrimaryStart;
      break;
    }
    case "SPACE_AROUND": {
      // Half gap before/after, full gaps between — (n) gaps total but
      // the outer two are halved.
      const free = contentSpan - flowSizeSum;
      gap = free / flow.length;
      startOffset = padPrimaryStart + gap / 2;
      break;
    }
    case "MIN":
    case undefined:
    default: {
      startOffset = padPrimaryStart;
      gap = spacing;
      break;
    }
  }

  // Walk flow children, assign primary positions, build new array.
  // `cursor` is the AABB top-left along the primary axis. The
  // child's stored `m02 / m12` is the rotated local origin in parent
  // space — for unrotated children that equals the AABB top-left, but
  // for a 180°-rotated 36×36 frame whose authored origin sits at the
  // AABB bottom-right (`m02 = m12 = 36`), naively writing `cursor`
  // into `m12` would shift the visible bounding box up by 36 px (the
  // Short-screen "down button" regression). `aabbOriginOffset` is the
  // delta between origin and AABB min, so the post-layout origin = `cursor + aabbOriginOffset`.
  // For primary-axis resize (`resizePrimaryAxisIfChanged`) we keep the
  // semantics that the local primary dimension is rewritten only when
  // the layout actually changes it (e.g. FILL grow); we still need
  // the primary AABB size for the cursor advance, separate from the
  // resized local size.
  const result: C[] = children.slice();
  let cursor = startOffset;
  for (const f of flow) {
    const original = f.child;
    const oldT = original.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const placedOrigin = cursor + f.aabbOriginOffset;
    const newM02 = horizontal ? placedOrigin : oldT.m02;
    const newM12 = horizontal ? oldT.m12 : placedOrigin;
    // Only rewrite the local size when the child is unrotated — for a
    // rotated child the local primary axis is no longer aligned with
    // the parent's, so resizing the local primary dimension would
    // change the rotated AABB unpredictably and silently corrupt the
    // child. The FILL-grow branch above does not assign rotated
    // children any extra space, so this guard never strands grow
    // distribution.
    const newSize = resizePrimarySizeForPlacedChild(original, oldT, f.primarySize, horizontal);
    const updated = {
      ...original,
      transform: { ...oldT, m02: newM02, m12: newM12 },
      size: newSize,
    } as C;
    result[f.idx] = updated;
    cursor += f.primarySize + gap;
  }
  return result;
}

function applyGridLayout<C extends PrimaryAxisChild>(parent: PrimaryAxisParent, children: readonly C[]): readonly C[] {
  if (parent.stackMode?.name !== "GRID") { return children; }
  const pSize = parent.size;
  if (!pSize) { throw new Error("GRID AutoLayout requires parent size."); }
  const flow = children
    .map((child, idx) => ({ child, idx }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }

  const columns = readGridColumns(parent, flow.length);
  // Row count comes from the FRAME's `gridRows` / `gridRowsSizing`
  // metadata when present — Figma's grid panel lets authors declare
  // more row tracks than the children currently occupy, and the
  // unused tracks reserve real space (children at row N appear at
  // gridRowsSizing[N]'s computed Y, not at `N * intrinsicRowHeight`).
  // Fall back to the content-derived row count when no metadata is
  // available (un-authored grids).
  const declaredRows = parent.gridRowsSizing?.entries.length ?? parent.gridRows?.entries.length ?? 0;
  const rows = Math.max(declaredRows, Math.ceil(flow.length / columns));
  const insets = contentInsets(parent);
  // Figma stores column/row gaps in dedicated `gridColumnGap` /
  // `gridRowGap` fields on the FRAME; `stackSpacing` /
  // `stackCounterSpacing` are the legacy spacing fields for VERTICAL /
  // HORIZONTAL stacks. Prefer the grid-specific field when present.
  const columnGap = parent.gridColumnGap ?? parent.stackSpacing ?? 0;
  const rowGap = parent.gridRowGap ?? parent.stackCounterSpacing ?? 0;

  // Interpret per-track sizing (FLEX / FIXED / AUTO). When the FRAME
  // doesn't carry `gridColumnsSizing` (or fewer entries than columns)
  // we pass `undefined` for those tracks — `computeFlexShare` /
  // `resolveTrackSize` then fall through to the child-content size,
  // preserving the previous behaviour for fixtures that don't author
  // explicit grid sizing.
  const interpretedColumnTracks = Array.from({ length: columns }, (_, col) => {
    const raw = parent.gridColumnsSizing?.entries[col]?.trackSize;
    return interpretGridTrackSize(raw);
  });
  const interpretedRowTracks = Array.from({ length: rows }, (_, row) => {
    const raw = parent.gridRowsSizing?.entries[row]?.trackSize;
    return interpretGridTrackSize(raw);
  });

  // Intrinsic (content) widths/heights per track — the MAX of child
  // size in that column/row.
  const intrinsicColumnWidths = Array.from({ length: columns }, (_, col) => {
    const columnChildren = flow.filter((_, index) => index % columns === col);
    return columnChildren.reduce((max, entry) => Math.max(max, entry.child.size?.x ?? 0), 0);
  });
  const intrinsicRowHeights = Array.from({ length: rows }, (_, row) => {
    const rowChildren = flow.slice(row * columns, row * columns + columns);
    return rowChildren.reduce((max, entry) => Math.max(max, entry.child.size?.y ?? 0), 0);
  });

  // Available space for FLEX distribution = parent size − padding − gaps.
  const availableColumnSpan = Math.max(
    0,
    pSize.x - insets.left - insets.right - columnGap * Math.max(0, columns - 1),
  );
  const availableRowSpan = Math.max(
    0,
    pSize.y - insets.top - insets.bottom - rowGap * Math.max(0, rows - 1),
  );

  const columnFlexShare = computeFlexShare(interpretedColumnTracks, intrinsicColumnWidths, availableColumnSpan);
  const rowFlexShare = computeFlexShare(interpretedRowTracks, intrinsicRowHeights, availableRowSpan);

  const columnWidths = interpretedColumnTracks.map((t, col) =>
    resolveTrackSize(t, intrinsicColumnWidths[col], columnFlexShare),
  );
  const rowHeights = interpretedRowTracks.map((t, row) =>
    resolveTrackSize(t, intrinsicRowHeights[row], rowFlexShare),
  );
  const columnStarts = columnWidths.map((_, col) =>
    insets.left + columnWidths.slice(0, col).reduce((sum, width) => sum + width, 0) + columnGap * col,
  );
  const rowStarts = rowHeights.map((_, row) =>
    insets.top + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + rowGap * row,
  );

  const result: C[] = children.slice();
  for (let index = 0; index < flow.length; index++) {
    const entry = flow[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const oldT = entry.child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const cellX = columnStarts[col];
    const cellY = rowStarts[row];
    const cellW = columnWidths[col];
    const cellH = rowHeights[row];
    const childW = entry.child.size?.x ?? 0;
    const childH = entry.child.size?.y ?? 0;
    // Per-child alignment inside the resolved cell. Default Figma
    // behaviour for a sized child in an un-aligned cell is MIN (top-
    // left of the cell), which matches the pre-FLEX behaviour.
    const hAlign = entry.child.gridChildHorizontalAlign ?? "MIN";
    const vAlign = entry.child.gridChildVerticalAlign ?? "MIN";
    const offsetX = resolveCellAlignment(hAlign, cellW, childW);
    const offsetY = resolveCellAlignment(vAlign, cellH, childH);
    result[entry.idx] = {
      ...entry.child,
      transform: { ...oldT, m02: cellX + offsetX, m12: cellY + offsetY },
    } as C;
  }
  return result;
}

/**
 * Resolve a single-axis alignment offset for a sized child inside a
 * resolved grid cell. MIN pins to 0, CENTER centres the child, MAX
 * pins to the trailing edge. STRETCH returns 0 — the child should
 * also be resized to fill the cell, which is a separate concern not
 * yet implemented here (children currently keep their authored size).
 */
function resolveCellAlignment(
  align: "MIN" | "CENTER" | "MAX" | "STRETCH",
  cellSize: number,
  childSize: number,
): number {
  if (align === "CENTER") { return (cellSize - childSize) / 2; }
  if (align === "MAX") { return cellSize - childSize; }
  return 0;
}

function applyCounterAxisPosition<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  if (!parent.size) { return children; }
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") { return children; }
  const flow = children
    .map((child, idx) => ({ child, idx }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }
  const insets = contentInsets(parent);
  const counterStart = horizontal ? insets.top : insets.left;
  const counterEnd = horizontal ? insets.bottom : insets.right;
  const counterParent = horizontal ? parent.size.y : parent.size.x;
  const contentSpan = counterParent - counterStart - counterEnd;
  const align = parent.stackCounterAlignItems?.name;
  const result: C[] = children.slice();
  for (const entry of flow) {
    if (!entry.child.size) { continue; }
    const oldT = entry.child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    // AABB-aware: a rotated child contributes its rotated extent
    // along the counter axis, and its stored origin (`m02 / m12`) is
    // offset from the AABB top-left by `originPos − aabbMin` — exactly
    // the same shape of fix the primary axis carries above. Without
    // this, a 180°-rotated icon inside a counter-axis-CENTER container
    // ends up half-out of the parent (the Short-screen "down button"
    // case where the AABB drifted up by the icon's height).
    const counterAxisLetter: "x" | "y" = horizontal ? "y" : "x";
    const childSpan = projectedAxisSpan(entry.child, horizontal ? "y" : "x");
    const originPos = horizontal ? oldT.m12 : oldT.m02;
    const aabb = childAabb(entry.child);
    const aabbMin = aabb ? aabb.min[counterAxisLetter] : originPos;
    const aabbOriginOffset = originPos - aabbMin;
    const offset = resolveStartOffset(align, contentSpan, childSpan, counterStart);
    const placedOrigin = offset + aabbOriginOffset;
    result[entry.idx] = {
      ...entry.child,
      transform: {
        ...oldT,
        m02: horizontal ? oldT.m02 : placedOrigin,
        m12: horizontal ? placedOrigin : oldT.m12,
      },
    } as C;
  }
  return result;
}

/**
 * AABB-aware metrics needed to lay out a child along the parent's
 * primary axis. Mirrors the per-child precomputation that
 * `applyAutoLayoutPrimaryAxis` does inline — pulled out so the
 * wrap layout can share the same rotation-aware sizing.
 */
type WrapChildMetrics = {
  readonly primarySize: number;
  readonly counterSize: number;
  readonly aabbPrimaryOriginOffset: number;
  readonly aabbCounterOriginOffset: number;
};

function wrapChildMetrics<C extends PrimaryAxisChild>(child: C, horizontal: boolean): WrapChildMetrics {
  const size = child.size!;
  const aabb = childAabb(child);
  if (!aabb) {
    return {
      primarySize: horizontal ? size.x : size.y,
      counterSize: horizontal ? size.y : size.x,
      aabbPrimaryOriginOffset: 0,
      aabbCounterOriginOffset: 0,
    };
  }
  const primarySize = horizontal ? aabb.max.x - aabb.min.x : aabb.max.y - aabb.min.y;
  const counterSize = horizontal ? aabb.max.y - aabb.min.y : aabb.max.x - aabb.min.x;
  const t = child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const primaryOrigin = horizontal ? t.m02 : t.m12;
  const counterOrigin = horizontal ? t.m12 : t.m02;
  const primaryAabbMin = horizontal ? aabb.min.x : aabb.min.y;
  const counterAabbMin = horizontal ? aabb.min.y : aabb.min.x;
  return {
    primarySize,
    counterSize,
    aabbPrimaryOriginOffset: primaryOrigin - primaryAabbMin,
    aabbCounterOriginOffset: counterOrigin - counterAabbMin,
  };
}

/**
 * Per-child counter-axis alignment offset within a wrap line. Mirrors
 * `resolveStartOffset` semantics (MIN/CENTER/MAX) but scoped to a
 * single child fitting inside the line's measured counter span — Figma
 * applies `stackCounterAlignItems` to each child within its line so
 * shorter siblings centre / pin to the bottom of taller ones.
 */
function resolveCounterAlignOffset(
  align: string | undefined,
  lineCounter: number,
  childCounter: number,
): number {
  const free = lineCounter - childCounter;
  if (free <= 0) { return 0; }
  if (align === "CENTER") { return free / 2; }
  if (align === "MAX") { return free; }
  return 0;
}

function applyWrapLayout<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  if (!parent.size) { return children; }
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") { return children; }
  const insets = contentInsets(parent);
  const pStart = horizontal ? insets.left : insets.top;
  const pEnd = horizontal ? insets.right : insets.bottom;
  const cStart = horizontal ? insets.top : insets.left;
  const cEnd = horizontal ? insets.bottom : insets.right;
  const primarySpan = (horizontal ? parent.size.x : parent.size.y) - pStart - pEnd;
  const counterSpan = (horizontal ? parent.size.y : parent.size.x) - cStart - cEnd;
  if (primarySpan <= 0 || counterSpan <= 0) { return children; }
  const spacing = parent.stackSpacing ?? 0;
  const counterSpacing = parent.stackCounterSpacing ?? 0;
  const align = parent.stackPrimaryAlignItems?.name;
  // For SPACE_BETWEEN / SPACE_EVENLY / SPACE_AROUND Figma distributes
  // the free space at layout time, so the *literal* `stackSpacing`
  // must not influence the wrap decision — only the raw item widths
  // do. With literal spacing the e-commerce stat-row would split
  // across multiple lines even though the SPACE_EVENLY distribution
  // happily fits everything on one line (the .fig file's authored
  // children x positions confirm Figma agrees).
  const isJustifySpace = align === "SPACE_BETWEEN" || align === "SPACE_EVENLY" || align === "SPACE_AROUND";
  const wrapSpacing = isJustifySpace ? 0 : spacing;
  const flow = children
    .map((child, idx) => ({ child, idx, metrics: wrapChildMetrics(child, horizontal) }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }

  type FlowEntry = typeof flow[number];
  type Line = { readonly entries: readonly FlowEntry[]; readonly primary: number; readonly counter: number };
  const lines: Line[] = [];
  const currentRef = { value: [] as FlowEntry[] };
  const currentPrimaryRef = { value: 0 };
  const currentCounterRef = { value: 0 };
  for (const entry of flow) {
    const nextPrimary = entry.metrics.primarySize;
    const nextCounter = entry.metrics.counterSize;
    const nextTotal = currentRef.value.length === 0 ? nextPrimary : currentPrimaryRef.value + wrapSpacing + nextPrimary;
    if (currentRef.value.length > 0 && nextTotal > primarySpan) {
      lines.push({ entries: currentRef.value, primary: currentPrimaryRef.value, counter: currentCounterRef.value });
      currentRef.value = [entry];
      currentPrimaryRef.value = nextPrimary;
      currentCounterRef.value = nextCounter;
      continue;
    }
    currentRef.value = [...currentRef.value, entry];
    currentPrimaryRef.value = nextTotal;
    currentCounterRef.value = Math.max(currentCounterRef.value, nextCounter);
  }
  if (currentRef.value.length > 0) {
    lines.push({ entries: currentRef.value, primary: currentPrimaryRef.value, counter: currentCounterRef.value });
  }

  const blockCounter = lines.reduce((sum, line) => sum + line.counter, 0) + counterSpacing * Math.max(0, lines.length - 1);
  // `stackPrimaryAlignContent` controls how the lines-as-a-block sits
  // in the counter span. `stackCounterAlignItems` is reused as the
  // per-child counter alignment within each line — Figma's
  // `LayoutMode.WRAP` reuses the property for both axes when only one
  // is set.
  const contentAlign = parent.stackPrimaryAlignContent?.name ?? parent.stackCounterAlignItems?.name;
  const itemCounterAlign = parent.stackCounterAlignItems?.name;
  const counterCursorRef = { value: resolveStartOffset(contentAlign, counterSpan, blockCounter, cStart) };
  const result: C[] = children.slice();
  for (const line of lines) {
    const lineLayout = resolveLinePrimaryLayout(line.entries, primarySpan, spacing, align, pStart);
    const primaryCursorRef = { value: lineLayout.startOffset };
    for (const entry of line.entries) {
      const oldT = entry.child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
      const placedPrimary = primaryCursorRef.value + entry.metrics.aabbPrimaryOriginOffset;
      const counterAlignOffset = resolveCounterAlignOffset(itemCounterAlign, line.counter, entry.metrics.counterSize);
      const placedCounter = counterCursorRef.value + counterAlignOffset + entry.metrics.aabbCounterOriginOffset;
      result[entry.idx] = {
        ...entry.child,
        transform: {
          ...oldT,
          m02: horizontal ? placedPrimary : placedCounter,
          m12: horizontal ? placedCounter : placedPrimary,
        },
      } as C;
      primaryCursorRef.value += entry.metrics.primarySize + lineLayout.gap;
    }
    counterCursorRef.value += line.counter + counterSpacing;
  }
  return result;
}

/**
 * Compute the starting offset and inter-item gap for a single wrap
 * line, including the SPACE_BETWEEN / SPACE_EVENLY / SPACE_AROUND
 * distributions that `resolveStartOffset` alone can't express.
 */
function resolveLinePrimaryLayout(
  entries: readonly { readonly metrics: WrapChildMetrics }[],
  primarySpan: number,
  spacing: number,
  align: string | undefined,
  insetStart: number,
): { readonly startOffset: number; readonly gap: number } {
  const flowSizeSum = entries.reduce((sum, entry) => sum + entry.metrics.primarySize, 0);
  switch (align) {
    case "SPACE_BETWEEN":
    case "SPACE_EVENLY": {
      if (entries.length > 1) {
        const free = primarySpan - flowSizeSum;
        return { startOffset: insetStart, gap: free / (entries.length - 1) };
      }
      return { startOffset: insetStart, gap: spacing };
    }
    case "SPACE_AROUND": {
      const free = primarySpan - flowSizeSum;
      const gap = free / entries.length;
      return { startOffset: insetStart + gap / 2, gap };
    }
    case "CENTER":
    case "MAX": {
      const usedSpacing = spacing * (entries.length - 1);
      const blockSize = flowSizeSum + usedSpacing;
      const free = primarySpan - blockSize;
      const start = align === "CENTER" ? insetStart + free / 2 : insetStart + free;
      return { startOffset: start, gap: spacing };
    }
    case "MIN":
    case undefined:
    default:
      return { startOffset: insetStart, gap: spacing };
  }
}

/**
 * Pick which of the child's *local* axes projects onto the parent's
 * counter axis. For an axis-aligned (unrotated) child the local axis
 * is the parent axis — local Y for horizontal parents, local X for
 * vertical. For a child rotated by a multiple of 90° the mapping
 * swaps: a 90°/270° rotation puts the child's local X along the
 * parent's Y direction (a vertical separator authored as a 74-wide
 * 0-tall line rotated 90° is what real Figma exports look like for
 * stat-row dividers, so stretching `size.y` would inflate the line's
 * thickness instead of its length).
 *
 * For non-orthogonal rotations there's no clean axis swap — the
 * child's AABB is wider on both axes than either local dimension, and
 * Figma's authoring contract effectively doesn't expose `STRETCH`
 * align-self on those. Return `null` so the caller leaves `size`
 * untouched rather than stretching the wrong axis.
 */
function localAxisForParentCounterAxis<C extends PrimaryAxisChild>(
  child: C,
  horizontal: boolean,
): "x" | "y" | null {
  const t = child.transform;
  if (!t) { return counterAxis(horizontal); }
  const axisAligned = t.m01 === 0 && t.m10 === 0;
  if (axisAligned) { return counterAxis(horizontal); }
  // 90°/270° rotation: m00 ≈ 0 and m11 ≈ 0, with m01/m10 carrying the
  // ±1 entries. After such a rotation the local X axis lies along the
  // parent's Y direction (and vice versa). Use a tolerance so the
  // tiny float residues real .fig files carry (m00 = 4.37e-8 from a
  // 90° rotation about Math.PI/2) still match.
  const tol = 1e-4;
  const orthogonalSwap = Math.abs(t.m00) <= tol && Math.abs(t.m11) <= tol
    && Math.abs(Math.abs(t.m01) - 1) <= tol && Math.abs(Math.abs(t.m10) - 1) <= tol;
  if (orthogonalSwap) {
    return horizontal ? "x" : "y";
  }
  return null;
}

function stretchCounterAxis<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  if (!parent.size) { return children; }
  const insets = contentInsets(parent);
  const span = horizontal ? parent.size.y - insets.top - insets.bottom : parent.size.x - insets.left - insets.right;
  if (span <= 0) { return children; }
  return children.map((child) => {
    if (child.stackChildAlignSelf?.name !== "STRETCH" || !child.size) {
      return child;
    }
    const localAxis = localAxisForParentCounterAxis(child, horizontal);
    if (localAxis === null) {
      // Arbitrary rotation: stretching either local axis would
      // misshape the child. Real-world authored stretchable children
      // are axis-aligned or 90°-rotated; non-orthogonal rotations
      // would need a separate transform rewrite that nothing in our
      // call chain currently expresses.
      return child;
    }
    return { ...child, size: resizeAxis(child.size, localAxis, span) } as C;
  });
}

/**
 * Resolve raw authored FRAME/SYMBOL child stretch without replaying positions.
 */
export function resolveAuthoredAutoLayoutFrameStretch<P extends PrimaryAxisParent, C extends PrimaryAxisChild>(
  parent: P,
  children: readonly C[],
): AutoLayoutResolution<C, P> {
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") {
    return { parent, children };
  }
  const horizontal = modeName === "HORIZONTAL";
  return { parent, children: stretchCounterAxis(parent, children, horizontal) };
}

/**
 * Materialise auto-layout after INSTANCE symbol selection and overrides.
 */
export function resolveAutoLayoutFrame<P extends PrimaryAxisParent, C extends PrimaryAxisChild>(
  parent: P,
  children: readonly C[],
): AutoLayoutResolution<C, P> {
  const modeName = parent.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL" && modeName !== "GRID") {
    return { parent: applyAspectLock(parent), children };
  }
  const flow = children.filter(isFlowChild);
  const horizontal = modeName !== "VERTICAL";
  const sizedParent = applyAspectLock(applyHugSizing(parent, flow, horizontal));
  const stretched = modeName === "GRID" ? children : stretchCounterAxis(sizedParent, children, horizontal);
  const positioned = applyAutoLayoutPositioning(sizedParent, stretched, modeName, horizontal);
  const ordered = parent.stackReverseZIndex === true ? positioned.slice().reverse() : positioned;
  return { parent: sizedParent, children: ordered };
}

function applyAutoLayoutPositioning<C extends PrimaryAxisChild, P extends PrimaryAxisParent>(
  parent: P,
  children: readonly C[],
  modeName: string,
  horizontal: boolean,
): readonly C[] {
  if (modeName === "GRID") {
    return applyGridLayout(parent, children);
  }
  if (stackWrapEnabled(parent.stackWrap)) {
    return applyWrapLayout(parent, children, horizontal);
  }
  return applyCounterAxisPosition(parent, applyAutoLayoutPrimaryAxis(parent, children), horizontal);
}
