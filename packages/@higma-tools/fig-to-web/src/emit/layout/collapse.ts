/**
 * @file Detect and skip "transparent wrapper" nodes during emission.
 *
 * Figma authoring is full of grouping constructs that exist purely to
 * box up a small subtree (a glyph, a row of icons) and have no visual
 * identity of their own. Naively emitting one `<div>` per FigNode
 * preserves their box, which forces children into yet another layer
 * of `position: absolute`. The result is correct but the DOM and the
 * generated JSX are full of `Frame > Frame > Frame > Vector` chains
 * where every layer is a same-size wrapper.
 *
 * We detect transparent wrappers and SKIP them at emission time,
 * accumulating their translation onto the next non-collapsed
 * descendant. The skipped wrapper's own transform composes through
 * its surviving descendant's `left` / `top`, so the painted result
 * stays pixel-identical while the JSX collapses N levels into 1.
 *
 * A node qualifies as a transparent wrapper when ALL of:
 *
 *   - it has no own paint (no visible fillPaints, no strokes,
 *     no effects, no shadow),
 *   - it does not impose layout on its children
 *     (no auto-layout, no clipping, no opacity reduction),
 *   - it does not introduce its own border-radius or stroke geometry,
 *   - it has exactly one *rendered* child,
 *   - its size matches that child's size (the child fills the wrapper
 *     so removing the wrapper does not shift the child's bounds), and
 *   - the wrapper's transform is pure translation (collapsing through
 *     a rotation or scale would corrupt the descendant's frame).
 *
 * Additional invariants enforced by callers:
 *
 *   - Only non-root containers are collapsible. The root of an emitted
 *     file is the page / component shell and must always emit.
 *   - We do not collapse children of a flex (auto-layout) parent.
 *     Flex flow positioning depends on the child being a real layout
 *     box; removing the wrapper would change which element the parent
 *     gaps and aligns against.
 */
import type { FigMatrix, FigNode } from "@higma-document-models/fig/types";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { ParentLayout } from "../style/style";

const SIZE_TOLERANCE = 0.5;

function hasVisiblePaint(paints: readonly { readonly visible?: boolean }[] | undefined): boolean {
  if (!paints) {
    return false;
  }
  for (const paint of paints) {
    if (paint.visible !== false) {
      return true;
    }
  }
  return false;
}

function isPureTranslation(matrix: FigMatrix | undefined): boolean {
  if (!matrix) {
    return true;
  }
  return matrix.m00 === 1 && matrix.m01 === 0 && matrix.m10 === 0 && matrix.m11 === 1;
}

function hasAutoLayout(node: FigNode): boolean {
  const mode = node.stackMode?.name;
  return mode === "VERTICAL" || mode === "HORIZONTAL";
}

function isRendered(node: FigNode): boolean {
  return node.visible !== false;
}

function singleRenderedChild(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): FigNode | undefined {
  const children = childrenOf(node);
  return findOnlyRendered(children, 0, undefined);
}

function findOnlyRendered(
  children: readonly FigNode[],
  index: number,
  found: FigNode | undefined,
): FigNode | undefined {
  if (index >= children.length) {
    return found;
  }
  const candidate = children[index];
  if (!isRendered(candidate)) {
    return findOnlyRendered(children, index + 1, found);
  }
  if (found) {
    return undefined;
  }
  return findOnlyRendered(children, index + 1, candidate);
}

function sizesMatch(parent: FigNode, child: FigNode): boolean {
  if (!parent.size || !child.size) {
    return false;
  }
  return Math.abs(parent.size.x - child.size.x) < SIZE_TOLERANCE
    && Math.abs(parent.size.y - child.size.y) < SIZE_TOLERANCE;
}

/**
 * True when the node is a transparent same-size single-child wrapper
 * that the emitter may safely skip.
 *
 * The caller still has to check the surrounding context (parent must
 * be static, node must not be a root) — this predicate only verifies
 * the node-local conditions.
 */
export function isTransparentWrapper(
  node: FigNode,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): boolean {
  if (node.type.name === "TEXT" || node.type.name === "INSTANCE") {
    return false;
  }
  if (node.type.name === "VECTOR" || node.type.name === "LINE" || node.type.name === "STAR") {
    return false;
  }
  if (hasVisiblePaint(node.fillPaints) || hasVisiblePaint(node.backgroundPaints)) {
    return false;
  }
  if (hasVisiblePaint(node.strokePaints)) {
    return false;
  }
  if (node.effects && node.effects.length > 0) {
    return false;
  }
  if (typeof node.opacity === "number" && node.opacity < 1) {
    return false;
  }
  if (node.clipsContent === true) {
    return false;
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    return false;
  }
  if (hasAutoLayout(node)) {
    return false;
  }
  if (!isPureTranslation(node.transform)) {
    return false;
  }
  const child = singleRenderedChild(node, childrenOf);
  if (!child) {
    return false;
  }
  if (!sizesMatch(node, child)) {
    return false;
  }
  return true;
}

export type Collapsed = {
  readonly node: FigNode;
  readonly offsetX: number;
  readonly offsetY: number;
};

/**
 * Walk down through nested transparent wrappers, accumulating each
 * skipped wrapper's translation. Returns the deepest non-skippable
 * node along with the cumulative offset that the caller must apply to
 * its `left` / `top` to keep the rendered position identical.
 *
 * `parentLayout` controls whether collapsing is allowed at the top
 * level — children of a flex parent are never collapsed (see file
 * header).
 */
export function collapseChain(
  node: FigNode,
  parentLayout: ParentLayout,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): Collapsed {
  if (parentLayout === "flex-row" || parentLayout === "flex-column") {
    return { node, offsetX: 0, offsetY: 0 };
  }
  return walkChain(node, 0, 0, childrenOf);
}

function walkChain(
  node: FigNode,
  offsetX: number,
  offsetY: number,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): Collapsed {
  if (!isTransparentWrapper(node, childrenOf)) {
    return { node, offsetX, offsetY };
  }
  const child = singleRenderedChild(node, childrenOf);
  if (!child) {
    return { node, offsetX, offsetY };
  }
  const dx = node.transform?.m02 ?? 0;
  const dy = node.transform?.m12 ?? 0;
  return walkChain(child, offsetX + dx, offsetY + dy, childrenOf);
}
