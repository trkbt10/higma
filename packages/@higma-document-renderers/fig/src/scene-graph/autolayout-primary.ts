/**
 * @file Figma autolayout primary-axis position recalculation.
 *
 * Counter-axis stretch (one child's cross-axis dimension expanding to
 * fill the parent) lives in `builder.ts:applyCounterAxisStretch`. This
 * module is the SoT for the *primary-axis* layout — distributing
 * children along the stack direction with the parent's
 * `stackPrimaryAlignItems` (MIN / CENTER / MAX / SPACE_BETWEEN /
 * SPACE_EVENLY) and respecting per-side stackPadding.
 *
 * Why we need it:
 *
 *   Figma's `derivedSymbolData` records the post-resize / post-CPA
 *   *positions* of each descendant inside an INSTANCE. When DSD entries
 *   pin a child's transform we honour them verbatim (they're a SoT for
 *   that INSTANCE's resolved layout). But when a FRAME is plain
 *   autolayout — no DSD because it's not the root of an INSTANCE
 *   subtree, just a layout container — we have to *compute* the
 *   children's positions ourselves.
 *
 *   The counter-axis stretch alone is not enough: Toolbar - Top's
 *   "Controls" FRAME is HORIZONTAL with stackPrimaryAlignItems=
 *   SPACE_EVENLY and three children (Leading, Spacer, Trailing). The
 *   children's stored x positions are SYMBOL-default values; without
 *   primary-axis computation Leading sits at its declared x while
 *   Trailing sits at *its* declared x, leaving Spacer in the middle —
 *   which by coincidence sometimes matches Figma's actual layout but
 *   generally drifts.
 *
 * Scope:
 *
 *   - layoutMode VERTICAL or HORIZONTAL (NONE → noop)
 *   - stackPrimaryAlignItems: MIN, CENTER, MAX, SPACE_BETWEEN,
 *     SPACE_EVENLY, SPACE_AROUND (the values the schema allows for
 *     `StackJustify`)
 *   - stackChildPrimaryGrow: per-child grow factor (FILL behaviour)
 *
 * Out of scope:
 *
 *   - stackWrap (multi-line autolayout) — not seen in edge-cases.fig
 *   - absolutely-positioned (stackPositioning=ABSOLUTE) children — they
 *     keep their authored transform
 */

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
  readonly autoLayout?: {
    readonly stackMode?: { readonly name?: string };
    readonly stackPadding?: number | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
    readonly stackSpacing?: number;
    readonly stackCounterSpacing?: number;
    readonly stackCounterAlignItems?: { readonly name?: string };
    readonly stackPrimaryAlignItems?: { readonly name?: string };
    readonly stackPrimaryAlignContent?: { readonly name?: string };
    readonly stackWrap?: boolean | { readonly name?: string };
    readonly stackReverseZIndex?: boolean;
  };
  readonly layoutConstraints?: {
    readonly stackPrimarySizing?: { readonly name?: string };
    readonly stackCounterSizing?: { readonly name?: string };
  };
};

export type PrimaryAxisChild = {
  readonly size?: { readonly x: number; readonly y: number };
  readonly transform?: {
    readonly m00: number; readonly m01: number; readonly m02: number;
    readonly m10: number; readonly m11: number; readonly m12: number;
  };
  readonly visible?: boolean;
  readonly layoutConstraints?: {
    readonly stackPositioning?: { readonly name?: string };
    readonly stackChildPrimaryGrow?: number;
    readonly stackChildAlignSelf?: { readonly name?: string };
  };
};

export type AutoLayoutResolution<C extends PrimaryAxisChild, P extends PrimaryAxisParent> = {
  readonly parent: P;
  readonly children: readonly C[];
};

function readPadding(sp: number | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } | undefined): { top: number; right: number; bottom: number; left: number } {
  if (typeof sp === "number") {
    return { top: sp, right: sp, bottom: sp, left: sp };
  }
  if (sp && typeof sp === "object") {
    return { top: sp.top, right: sp.right, bottom: sp.bottom, left: sp.left };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function resizePrimaryAxisIfChanged(
  size: { readonly x: number; readonly y: number } | undefined,
  newSizeAxis: number,
  horizontal: boolean,
): { readonly x: number; readonly y: number } | undefined {
  if (!size) { return undefined; }
  if (horizontal) {
    if (Math.abs(size.x - newSizeAxis) <= 0.5) { return size; }
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
  if (axis === "x") {
    if (Math.abs(size.x - value) <= 0.5) { return size; }
    return { x: value, y: size.y };
  }
  if (Math.abs(size.y - value) <= 0.5) { return size; }
  return { x: size.x, y: value };
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
  const padding = readPadding(parent.autoLayout?.stackPadding);
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
  if (child.layoutConstraints?.stackPositioning?.name === "ABSOLUTE") { return false; }
  return child.size !== undefined;
}

function stackWrapEnabled(value: boolean | { readonly name?: string } | undefined): boolean {
  if (value === true) {
    return true;
  }
  if (value && typeof value === "object") {
    return value.name === "WRAP";
  }
  return false;
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

function applyAspectLock<P extends PrimaryAxisParent>(parent: P): P {
  if (parent.proportionsConstrained !== true) { return parent; }
  const target = parent.targetAspectRatio;
  if (!target) {
    throw new Error(`AutoLayout aspect lock on "${"name" in parent ? String(parent.name) : "node"}" requires targetAspectRatio.`);
  }
  if (!parent.size) {
    throw new Error("AutoLayout aspect lock requires parent size.");
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
  const autoLayout = parent.autoLayout;
  if (!autoLayout) { return parent; }
  const insets = contentInsets(parent);
  const pAxis = primaryAxis(horizontal);
  const cAxis = counterAxis(horizontal);
  const pStart = horizontal ? insets.left : insets.top;
  const pEnd = horizontal ? insets.right : insets.bottom;
  const cStart = horizontal ? insets.top : insets.left;
  const cEnd = horizontal ? insets.bottom : insets.right;
  const spacing = autoLayout.stackSpacing ?? 0;
  const modeName = autoLayout.stackMode?.name;
  const primaryHug = parent.layoutConstraints?.stackPrimarySizing?.name === "RESIZE_TO_FIT";
  const counterHug = parent.layoutConstraints?.stackCounterSizing?.name === "RESIZE_TO_FIT";
  if (!primaryHug && !counterHug) { return parent; }

  const primaryContent = (() => {
    if (modeName === "GRID") {
      const cols = readGridColumns(parent, flow.length);
      const widths = Array.from({ length: cols }, (_, col) => {
        const columnChildren = flow.filter((_, index) => index % cols === col);
        return columnChildren.reduce((max, child) => Math.max(max, axisSize(child.size!, pAxis)), 0);
      });
      return widths.reduce((sum, value) => sum + value, 0) + spacing * Math.max(0, cols - 1);
    }
    return flow.reduce((sum, child) => sum + axisSize(child.size!, pAxis), 0) + spacing * Math.max(0, flow.length - 1);
  })();

  const counterContent = (() => {
    if (modeName === "GRID") {
      const cols = readGridColumns(parent, flow.length);
      const rows = Math.ceil(flow.length / cols);
      const rowGap = autoLayout.stackCounterSpacing ?? 0;
      const heights = Array.from({ length: rows }, (_, row) => {
        const rowChildren = flow.slice(row * cols, row * cols + cols);
        return rowChildren.reduce((max, child) => Math.max(max, axisSize(child.size!, cAxis)), 0);
      });
      return heights.reduce((sum, value) => sum + value, 0) + rowGap * Math.max(0, rows - 1);
    }
    return flow.reduce((max, child) => Math.max(max, axisSize(child.size!, cAxis)), 0);
  })();

  const nextPrimary = primaryHug ? clampAxis(primaryContent + pStart + pEnd, pAxis, parent) : axisSize(parent.size, pAxis);
  const nextCounter = counterHug ? clampAxis(counterContent + cStart + cEnd, cAxis, parent) : axisSize(parent.size, cAxis);
  const nextSize = horizontal ? { x: nextPrimary, y: nextCounter } : { x: nextCounter, y: nextPrimary };
  const resized = resizeBothAxesIfChanged(parent.size, nextSize);
  if (resized === parent.size) { return parent; }
  return { ...parent, size: resized };
}

function readGridColumns(parent: PrimaryAxisParent, childCount: number): number {
  const gridColumns = parent.gridColumns;
  if (gridColumns !== undefined && gridColumns.entries.length > 0) {
    return gridColumns.entries.length;
  }
  const content = parent.autoLayout?.stackPrimaryAlignContent?.name;
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
 * `applyCounterAxisStretch` is expected to have already run, so each
 * child's `size` is already correct on the counter axis when relevant.
 */
export function applyAutoLayoutPrimaryAxis<C extends PrimaryAxisChild>(parent: PrimaryAxisParent, children: readonly C[]): readonly C[] {
  const autoLayout = parent.autoLayout;
  if (!autoLayout) return children;
  const modeName = autoLayout.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL") return children;
  const pSize = parent.size;
  if (!pSize) return children;

  const horizontal = modeName === "HORIZONTAL";
  const insets = contentInsets(parent);
  const padPrimaryStart = horizontal ? insets.left : insets.top;
  const padPrimaryEnd = horizontal ? insets.right : insets.bottom;
  const primaryParent = horizontal ? pSize.x : pSize.y;
  const contentSpan = primaryParent - padPrimaryStart - padPrimaryEnd;
  if (contentSpan <= 0) return children;

  // Filter to layout-participating children (visible + non-absolute).
  type Idx = { idx: number; child: C; primarySize: number };
  const flow: Idx[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.visible === false) continue;
    const pos = c.layoutConstraints?.stackPositioning?.name;
    if (pos === "ABSOLUTE") continue;
    if (!c.size) continue;
    flow.push({ idx: i, child: c, primarySize: horizontal ? c.size.x : c.size.y });
  }
  if (flow.length === 0) return children;

  // Apply FILL grow first: any child with stackChildPrimaryGrow=1 takes
  // the leftover space after fixed children + spacing. We split the
  // leftover evenly among grow children.
  const spacing = autoLayout.stackSpacing ?? 0;
  const align = autoLayout.stackPrimaryAlignItems?.name;
  const isJustifySpace = align === "SPACE_BETWEEN" || align === "SPACE_EVENLY" || align === "SPACE_AROUND";

  const fixedSizeSum = flow.reduce((s, e) => s + e.primarySize, 0);
  const growChildren = flow.filter((e) => (e.child.layoutConstraints?.stackChildPrimaryGrow ?? 0) > 0);
  if (growChildren.length > 0 && !isJustifySpace) {
    // Available space minus base sizes minus inter-item spacing.
    const totalSpacing = spacing * (flow.length - 1);
    const free = contentSpan - fixedSizeSum - totalSpacing;
    if (free > 0) {
      const perGrow = free / growChildren.length;
      for (const g of growChildren) {
        g.primarySize = g.primarySize + perGrow;
      }
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
    case "SPACE_BETWEEN": {
      // First flush to the start, last flush to the end. Spacing is
      // distributed across the (n-1) gaps. Single child collapses to MIN.
      if (flow.length > 1) {
        const free = contentSpan - flowSizeSum;
        gap = free / (flow.length - 1);
      }
      startOffset = padPrimaryStart;
      break;
    }
    case "SPACE_EVENLY": {
      // Equal gap before, between and after — (n+1) equal gaps.
      const free = contentSpan - flowSizeSum;
      gap = free / (flow.length + 1);
      startOffset = padPrimaryStart + gap;
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
  const result: C[] = children.slice();
  let cursor = startOffset;
  for (const f of flow) {
    const original = f.child;
    const oldT = original.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const newM02 = horizontal ? cursor : oldT.m02;
    const newM12 = horizontal ? oldT.m12 : cursor;
    const newSizeAxis = f.primarySize;
    const newSize = resizePrimaryAxisIfChanged(original.size, newSizeAxis, horizontal);
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
  const autoLayout = parent.autoLayout;
  if (!autoLayout) { return children; }
  const pSize = parent.size;
  if (!pSize) { throw new Error("GRID AutoLayout requires parent size."); }
  const flow = children
    .map((child, idx) => ({ child, idx }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }

  const columns = readGridColumns(parent, flow.length);
  const rows = Math.ceil(flow.length / columns);
  const insets = contentInsets(parent);
  const columnGap = autoLayout.stackSpacing ?? 0;
  const rowGap = autoLayout.stackCounterSpacing ?? 0;
  const columnWidths = Array.from({ length: columns }, (_, col) => {
    const columnChildren = flow.filter((_, index) => index % columns === col);
    return columnChildren.reduce((max, entry) => Math.max(max, entry.child.size?.x ?? 0), 0);
  });
  const rowHeights = Array.from({ length: rows }, (_, row) => {
    const rowChildren = flow.slice(row * columns, row * columns + columns);
    return rowChildren.reduce((max, entry) => Math.max(max, entry.child.size?.y ?? 0), 0);
  });
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
    result[entry.idx] = {
      ...entry.child,
      transform: { ...oldT, m02: columnStarts[col], m12: rowStarts[row] },
    } as C;
  }
  return result;
}

function applyCounterAxisPosition<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  const autoLayout = parent.autoLayout;
  if (!autoLayout || !parent.size) { return children; }
  const flow = children
    .map((child, idx) => ({ child, idx }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }
  const insets = contentInsets(parent);
  const counterStart = horizontal ? insets.top : insets.left;
  const counterEnd = horizontal ? insets.bottom : insets.right;
  const counterParent = horizontal ? parent.size.y : parent.size.x;
  const contentSpan = counterParent - counterStart - counterEnd;
  const align = autoLayout.stackCounterAlignItems?.name;
  const result: C[] = children.slice();
  for (const entry of flow) {
    if (!entry.child.size) { continue; }
    const oldT = entry.child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const childSpan = horizontal ? entry.child.size.y : entry.child.size.x;
    const offset = resolveStartOffset(align, contentSpan, childSpan, counterStart);
    result[entry.idx] = {
      ...entry.child,
      transform: {
        ...oldT,
        m02: horizontal ? oldT.m02 : offset,
        m12: horizontal ? offset : oldT.m12,
      },
    } as C;
  }
  return result;
}

function applyWrapLayout<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  const autoLayout = parent.autoLayout;
  if (!autoLayout || !parent.size) { return children; }
  const insets = contentInsets(parent);
  const pStart = horizontal ? insets.left : insets.top;
  const pEnd = horizontal ? insets.right : insets.bottom;
  const cStart = horizontal ? insets.top : insets.left;
  const cEnd = horizontal ? insets.bottom : insets.right;
  const primarySpan = (horizontal ? parent.size.x : parent.size.y) - pStart - pEnd;
  const counterSpan = (horizontal ? parent.size.y : parent.size.x) - cStart - cEnd;
  if (primarySpan <= 0 || counterSpan <= 0) { return children; }
  const spacing = autoLayout.stackSpacing ?? 0;
  const counterSpacing = autoLayout.stackCounterSpacing ?? 0;
  const flow = children
    .map((child, idx) => ({ child, idx }))
    .filter((entry) => isFlowChild(entry.child));
  if (flow.length === 0) { return children; }

  type Line = { readonly entries: typeof flow; readonly primary: number; readonly counter: number };
  const lines: Line[] = [];
  let current: typeof flow = [];
  let currentPrimary = 0;
  let currentCounter = 0;
  for (const entry of flow) {
    const nextPrimary = horizontal ? entry.child.size!.x : entry.child.size!.y;
    const nextCounter = horizontal ? entry.child.size!.y : entry.child.size!.x;
    const nextTotal = current.length === 0 ? nextPrimary : currentPrimary + spacing + nextPrimary;
    if (current.length > 0 && nextTotal > primarySpan) {
      lines.push({ entries: current, primary: currentPrimary, counter: currentCounter });
      current = [entry];
      currentPrimary = nextPrimary;
      currentCounter = nextCounter;
      continue;
    }
    current = [...current, entry];
    currentPrimary = nextTotal;
    currentCounter = Math.max(currentCounter, nextCounter);
  }
  if (current.length > 0) {
    lines.push({ entries: current, primary: currentPrimary, counter: currentCounter });
  }

  const blockCounter = lines.reduce((sum, line) => sum + line.counter, 0) + counterSpacing * Math.max(0, lines.length - 1);
  const contentAlign = autoLayout.stackPrimaryAlignContent?.name ?? autoLayout.stackCounterAlignItems?.name;
  let counterCursor = resolveStartOffset(contentAlign, counterSpan, blockCounter, cStart);
  const result: C[] = children.slice();
  for (const line of lines) {
    let primaryCursor = resolveStartOffset(autoLayout.stackPrimaryAlignItems?.name, primarySpan, line.primary, pStart);
    for (const entry of line.entries) {
      const oldT = entry.child.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
      const size = entry.child.size!;
      result[entry.idx] = {
        ...entry.child,
        transform: {
          ...oldT,
          m02: horizontal ? primaryCursor : counterCursor,
          m12: horizontal ? counterCursor : primaryCursor,
        },
      } as C;
      primaryCursor += (horizontal ? size.x : size.y) + spacing;
    }
    counterCursor += line.counter + counterSpacing;
  }
  return result;
}

function stretchCounterAxis<C extends PrimaryAxisChild>(
  parent: PrimaryAxisParent,
  children: readonly C[],
  horizontal: boolean,
): readonly C[] {
  if (!parent.size) { return children; }
  const insets = contentInsets(parent);
  const span = horizontal ? parent.size.y - insets.top - insets.bottom : parent.size.x - insets.left - insets.right;
  const axis = counterAxis(horizontal);
  if (span <= 0) { return children; }
  return children.map((child) => {
    if (child.layoutConstraints?.stackChildAlignSelf?.name !== "STRETCH" || !child.size) {
      return child;
    }
    return { ...child, size: resizeAxis(child.size, axis, span) } as C;
  });
}

export function resolveAutoLayoutFrame<P extends PrimaryAxisParent, C extends PrimaryAxisChild>(
  parent: P,
  children: readonly C[],
): AutoLayoutResolution<C, P> {
  const autoLayout = parent.autoLayout;
  if (!autoLayout) {
    return { parent: applyAspectLock(parent), children };
  }
  const modeName = autoLayout.stackMode?.name;
  if (modeName !== "VERTICAL" && modeName !== "HORIZONTAL" && modeName !== "GRID") {
    return { parent: applyAspectLock(parent), children };
  }
  const flow = children.filter(isFlowChild);
  const horizontal = modeName !== "VERTICAL";
  const sizedParent = applyAspectLock(applyHugSizing(parent, flow, horizontal));
  const stretched = modeName === "GRID" ? children : stretchCounterAxis(sizedParent, children, horizontal);
  const positioned = (() => {
    if (modeName === "GRID") {
      return applyGridLayout(sizedParent, stretched);
    }
    if (stackWrapEnabled(autoLayout.stackWrap)) {
      return applyWrapLayout(sizedParent, stretched, horizontal);
    }
    return applyCounterAxisPosition(sizedParent, applyAutoLayoutPrimaryAxis(sizedParent, stretched), horizontal);
  })();
  const ordered = autoLayout.stackReverseZIndex === true ? positioned.slice().reverse() : positioned;
  return { parent: sizedParent, children: ordered };
}
