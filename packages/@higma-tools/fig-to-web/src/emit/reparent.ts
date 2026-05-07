/**
 * @file Spatial reparenting for flat fig trees.
 *
 * Tools that flatten Figma documents (notably `image-to-fig`) emit
 * every node as a sibling of the page root, even when the original
 * design carried nested sections. Result: a `Hero` frame with
 * `stackMode: VERTICAL` ends up empty, while `HeroTitle` /
 * `HeroCopy` / `HeroMedia` sit alongside it as siblings positioned
 * inside Hero's bounding box.
 *
 * This pass repairs that flattening WITHOUT mutating the source
 * tree. For each frame's children we identify "empty auto-layout
 * sections" — Figma frames authored with `stackMode` but no
 * children — and re-attribute later siblings whose bounding boxes
 * fall inside the section. The downstream emitter then walks the
 * repaired children list, the section's own auto-layout flows its
 * adopted children, and the parent frame's children list becomes
 * a clean vertical stack the layout inferrer can recognise.
 *
 * Constraints (deliberately narrow to avoid mis-attribution):
 *
 *   1. The host must be a `FRAME` with explicit `stackMode` set.
 *      A plain background rectangle does not pull siblings in.
 *   2. The host must currently have no rendered children.
 *      We never overwrite an authored child list.
 *   3. The candidate sibling's bounding box must be fully inside
 *      the host's bounding box (with a small slack for float
 *      noise). Partial overlaps are left alone — they're more
 *      likely intentional UI overlays.
 *   4. The candidate sibling must come *after* the host in the
 *      paint order. Earlier siblings would have been painted under
 *      the host and would never have been visible.
 */
import type { FigNode, FigMatrix } from "@higma-document-models/fig/types";
import { guidToString, safeChildren } from "@higma-document-models/fig/domain";

const EPSILON_PX = 0.5;

type Bounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type ReparentResult = {
  /**
   * Children-overlay keyed by `guidToString(parent)`. Consumers walk
   * the original tree but consult this map first; missing entries
   * mean "no reparenting happened, use `safeChildren` directly".
   */
  readonly childrenByParent: ReadonlyMap<string, readonly FigNode[]>;
  /**
   * Synthetic transform overrides keyed by `guidToString(node)`.
   * When a child is moved into a new parent, its position must be
   * expressed relative to that parent — we precompute the adjusted
   * transform here so the emitter doesn't have to know about
   * reparenting beyond a getter for transform / children.
   */
  readonly transformByGuid: ReadonlyMap<string, FigMatrix>;
};

/** Run the reparent pass on the entire tree rooted at `root`. */
export function buildReparentResult(root: FigNode): ReparentResult {
  const childrenByParent = new Map<string, readonly FigNode[]>();
  const transformByGuid = new Map<string, FigMatrix>();
  visit(root, childrenByParent, transformByGuid);
  return { childrenByParent, transformByGuid };
}

function visit(
  node: FigNode,
  childrenByParent: Map<string, readonly FigNode[]>,
  transformByGuid: Map<string, FigMatrix>,
): void {
  const reparented = reparentChildren(node, transformByGuid);
  if (reparented) {
    childrenByParent.set(guidToString(node.guid), reparented);
    for (const child of reparented) {
      visit(child, childrenByParent, transformByGuid);
    }
    return;
  }
  for (const child of safeChildren(node)) {
    visit(child, childrenByParent, transformByGuid);
  }
}

function reparentChildren(
  parent: FigNode,
  transformByGuid: Map<string, FigMatrix>,
): readonly FigNode[] | undefined {
  const original = safeChildren(parent);
  if (original.length < 2) {
    return undefined;
  }
  const claimed = new Set<number>();
  const adopted = new Map<number, number[]>(); // hostIndex → adoptedIndices
  for (let i = 0; i < original.length; i += 1) {
    const host = original[i];
    if (!isEmptySectionFrame(host)) {
      continue;
    }
    const hostBounds = boundsOf(host);
    if (!hostBounds) {
      continue;
    }
    const adoptedHere: number[] = [];
    for (let j = i + 1; j < original.length; j += 1) {
      if (claimed.has(j)) {
        continue;
      }
      const candidate = original[j];
      const candBounds = boundsOf(candidate);
      if (!candBounds) {
        continue;
      }
      if (!fullyContained(candBounds, hostBounds)) {
        continue;
      }
      adoptedHere.push(j);
      claimed.add(j);
    }
    if (adoptedHere.length > 0) {
      adopted.set(i, adoptedHere);
    }
  }
  if (adopted.size === 0) {
    return undefined;
  }
  return rebuildChildren(original, adopted, claimed, transformByGuid);
}

function rebuildChildren(
  original: readonly FigNode[],
  adopted: ReadonlyMap<number, readonly number[]>,
  claimed: ReadonlySet<number>,
  transformByGuid: Map<string, FigMatrix>,
): readonly FigNode[] {
  const out: FigNode[] = [];
  for (let i = 0; i < original.length; i += 1) {
    if (claimed.has(i)) {
      continue;
    }
    const node = original[i];
    const adoptedIdx = adopted.get(i);
    if (!adoptedIdx) {
      out.push(node);
      continue;
    }
    const wrapped = wrapWithAdopted(node, adoptedIdx.map((idx) => original[idx]), transformByGuid);
    out.push(wrapped);
  }
  return out;
}

/**
 * Produce a virtual host node that exposes the adopted siblings as
 * its children. Each adopted child is itself wrapped — its
 * `transform` is rewritten so the position becomes relative to the
 * host's origin (the original transform was relative to the
 * grandparent in the source tree).
 *
 * The host's `stackMode` is *cleared* on the wrapper. Tools that
 * flatten Figma trees keep the section frame's authored auto-layout
 * metadata — but the actual content was placed at absolute
 * coordinates that often do NOT match flex flow (e.g., a hero block
 * with a title on the left and an image on the right that flex
 * column would stack). Keeping the auto-layout would make the
 * adopted children flow into a stack and visibly break the design.
 * The host now functions as a positioned container; its children
 * keep their absolute placement relative to it.
 */
function wrapWithAdopted(
  host: FigNode,
  adoptedNodes: readonly FigNode[],
  transformByGuid: Map<string, FigMatrix>,
): FigNode {
  const hostX = host.transform?.m02 ?? 0;
  const hostY = host.transform?.m12 ?? 0;
  const wrappedChildren = adoptedNodes.map((node) => {
    const oldX = node.transform?.m02 ?? 0;
    const oldY = node.transform?.m12 ?? 0;
    const newTransform: FigMatrix = {
      m00: node.transform?.m00 ?? 1,
      m01: node.transform?.m01 ?? 0,
      m10: node.transform?.m10 ?? 0,
      m11: node.transform?.m11 ?? 1,
      m02: oldX - hostX,
      m12: oldY - hostY,
    };
    transformByGuid.set(guidToString(node.guid), newTransform);
    return Object.assign({}, node, { transform: newTransform });
  });
  return Object.assign({}, host, {
    children: wrappedChildren,
    stackMode: undefined,
    stackSpacing: undefined,
    stackPrimaryAlignItems: undefined,
    stackCounterAlignItems: undefined,
    stackPadding: undefined,
    stackHorizontalPadding: undefined,
    stackVerticalPadding: undefined,
    stackPaddingRight: undefined,
    stackPaddingBottom: undefined,
  });
}

function isEmptySectionFrame(node: FigNode): boolean {
  if (node.type.name !== "FRAME") {
    return false;
  }
  const stack = node.stackMode?.name;
  if (stack !== "VERTICAL" && stack !== "HORIZONTAL") {
    return false;
  }
  const children = safeChildren(node);
  return children.length === 0;
}

function boundsOf(node: FigNode): Bounds | undefined {
  if (!node.size) {
    return undefined;
  }
  const x = node.transform?.m02 ?? 0;
  const y = node.transform?.m12 ?? 0;
  return { x, y, width: node.size.x, height: node.size.y };
}

function fullyContained(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.x + EPSILON_PX >= outer.x
    && inner.y + EPSILON_PX >= outer.y
    && inner.x + inner.width <= outer.x + outer.width + EPSILON_PX
    && inner.y + inner.height <= outer.y + outer.height + EPSILON_PX
  );
}
