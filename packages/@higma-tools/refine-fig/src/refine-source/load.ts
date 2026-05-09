/**
 * @file Refining-oriented view over a loaded `.fig` file.
 *
 * The skill needs both:
 *
 *   1. The raw `LoadedFigFile.nodeChanges` array — mutated in place by
 *      `applyPlan` so `saveFigFile` writes the refined bytes.
 *
 *   2. A read-only resolved tree where every node's
 *      `fillPaints` / `strokePaints` already reflects the document
 *      style registry. Analysis walks this tree so per-node colours
 *      match what the renderer (and Figma) actually paint.
 *
 * The style-resolution helpers come from `@higma-document-models/fig
 * /symbols`; we inline a small recursive pass here rather than depend
 * on `@higma-tools/fig-to-web` because same-scope tool packages must
 * not depend on one another.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type {
  FigStyleRegistry,
  LoadedFigFile,
  NodeTreeResult,
} from "@higma-document-models/fig/domain";
import { buildNodeTree, getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { buildFigStyleRegistry, resolveNodeStyleIds, resolveStyledPaint } from "@higma-document-models/fig/symbols";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

export type RefineSource = {
  readonly loaded: LoadedFigFile;
  readonly tree: NodeTreeResult;
  readonly nodesByGuid: ReadonlyMap<string, FigNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly userCanvases: readonly FigNode[];
  readonly internalCanvas: FigNode | undefined;
  readonly fillStyleProxies: readonly FigNode[];
  readonly textStyleProxies: readonly FigNode[];
  readonly topFrames: readonly FigNode[];
};

/** Load a `.fig` byte buffer for refinement (raw + resolved view). */
export async function loadRefineSource(bytes: Uint8Array): Promise<RefineSource> {
  const loaded = await loadFigFile(bytes);
  const rawTree = buildNodeTree(loaded.nodeChanges);
  const rawByGuid = indexNodes(rawTree.roots);
  const styleRegistry = buildFigStyleRegistry(rawByGuid);
  const resolvedRoots = rawTree.roots.map((root) => resolveSubtree(root, styleRegistry));
  const tree: NodeTreeResult = { ...rawTree, roots: resolvedRoots };
  const nodesByGuid = indexNodes(resolvedRoots);

  const allCanvases = collectCanvases(resolvedRoots);
  const userCanvases = allCanvases.filter((c) => c.internalOnly !== true);
  const internalCanvas = allCanvases.find((c) => c.internalOnly === true);

  const fillStyleProxies: FigNode[] = [];
  const textStyleProxies: FigNode[] = [];
  if (internalCanvas) {
    for (const child of safeChildren(internalCanvas)) {
      const styleType = child.styleType?.name;
      if (styleType === "FILL") {
        fillStyleProxies.push(child);
      } else if (styleType === "TEXT") {
        textStyleProxies.push(child);
      }
    }
  }

  const topFrames: FigNode[] = [];
  for (const canvas of userCanvases) {
    for (const child of safeChildren(canvas)) {
      const t = getNodeType(child);
      if (t === "FRAME" || t === "COMPONENT" || t === "COMPONENT_SET") {
        topFrames.push(child);
      }
    }
  }

  return {
    loaded,
    tree,
    nodesByGuid,
    styleRegistry,
    userCanvases,
    internalCanvas,
    fillStyleProxies,
    textStyleProxies,
    topFrames,
  };
}

function collectCanvases(roots: readonly FigNode[]): readonly FigNode[] {
  return roots
    .filter((root) => getNodeType(root) === "DOCUMENT")
    .flatMap((root) => safeChildren(root).filter((child) => getNodeType(child) === "CANVAS"));
}

function indexNodes(roots: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const root of roots) {
    walk(root, out);
  }
  return out;
}

function walk(node: FigNode, out: Map<string, FigNode>): void {
  out.set(guidToString(node.guid), node);
  for (const child of safeChildren(node)) {
    walk(child, out);
  }
}

/**
 * Replace each node's `fillPaints` / `strokePaints` (and per-text-run
 * `fillPaints` when the run carries a `styleIdForFill`) with the
 * registry-resolved paints. This is a recursive *immutable* rebuild —
 * cost is proportional to the styled-node count rather than total
 * tree size.
 */
function resolveSubtree(node: FigNode, registry: FigStyleRegistry): FigNode {
  const styleResolved = resolveNodeStyleIds(node, registry);
  const textResolved = resolveTextOverrides(styleResolved, registry);
  const rawChildren = node.children;
  if (!rawChildren || rawChildren.length === 0) {
    return textResolved;
  }
  const newChildren = rawChildren.map((child) => {
    if (!child) {
      return child;
    }
    return resolveSubtree(child, registry);
  });
  const childrenChanged = newChildren.some((child, i) => child !== rawChildren[i]);
  if (!childrenChanged && textResolved === node) {
    return node;
  }
  return { ...textResolved, children: newChildren };
}

/**
 * Resolve `fillPaints` overrides on a TEXT node's per-character
 * style table through the document-wide style registry.
 *
 * `FigNode.textData` (`FigKiwiTextData`) is the SoT field for text
 * style overrides; `FigNode.styleOverrideTable` exists too but is
 * typed for VECTOR per-path overrides at the FigNode level. For TEXT
 * we read through `textData.styleOverrideTable` only — the entries
 * are `FigTextStyleOverrideEntry`s with `styleIdForFill` already
 * properly typed as `FigStyleId`.
 */
function resolveTextOverrides(node: FigNode, registry: FigStyleRegistry): FigNode {
  if (getNodeType(node) !== "TEXT") {
    return node;
  }
  const td = node.textData;
  const sot = td?.styleOverrideTable;
  if (!sot || sot.length === 0) {
    return node;
  }
  const newSot = sot.map((entry) => {
    const resolved = resolveStyledPaint(entry.styleIdForFill, entry.fillPaints, registry);
    if (resolved === undefined) {
      return entry;
    }
    if (resolved === entry.fillPaints) {
      return entry;
    }
    return { ...entry, fillPaints: resolved };
  });
  const changed = newSot.some((entry, i) => entry !== sot[i]);
  if (!changed) {
    return node;
  }
  const newTd = { ...td, styleOverrideTable: newSot };
  return { ...node, textData: newTd };
}
