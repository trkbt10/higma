/**
 * @file Load a .fig file as a raw FigNode tree, deliberately bypassing
 * the high-level FigDesignDocument conversion.
 *
 * `createFigDesignDocument` runs the full instance-resolution pipeline
 * (override path resolution, derived symbol data, etc.). On real-world
 * Figma exports — including the Youtube Mobile App UIKit fixture used
 * by this package's smoke run — that pipeline can fire defensive guards
 * inside `@higma-document-models/fig/symbols`. Those guards belong to
 * the override-resolver's correctness contract, not ours: a code-emitter
 * does not need full instance expansion to reproduce the page surface.
 *
 * We instead consume `loadFigFile` (raw nodeChanges + roundtrip state)
 * and `buildNodeTree` (parent → children topology) directly. The result
 * is a typed view of the document that is sufficient for emitting JSX
 * and design tokens, and that does not depend on overrides resolving
 * cleanly.
 *
 * Style-id resolution: `.fig` files cache `fillPaints` / `strokePaints`
 * on every node, but those caches go stale whenever the referenced
 * shared style was edited after the cache was written. The renderer
 * (which we visually diff against) always rereads through the style
 * registry — if our emitter doesn't, every styled node renders the
 * stale colour and the diff blows up. We pre-resolve once at load time
 * so every downstream reader of `node.fillPaints` / `node.strokePaints`
 * automatically sees the live paint.
 */
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { LoadedFigFile, NodeTreeResult, FigStyleRegistry } from "@higma-document-models/fig/domain";
import { buildNodeTree, getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { buildFigStyleRegistry, resolveNodeStyleIds, resolveStyledPaint } from "@higma-document-models/fig/symbols";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

export type FigSource = {
  readonly loaded: LoadedFigFile;
  readonly tree: NodeTreeResult;
  /** Flat map keyed by `sessionID:localID` covering every node in the file. */
  readonly nodesByGuid: ReadonlyMap<string, FigNode>;
  /**
   * Document-wide registry mapping style GUIDs to their resolved
   * paints. Exposed so emitters can resolve INSTANCE-level
   * `symbolOverrides[].styleIdForStrokeFill` / `styleIdForFill`
   * lookups against the same registry the loader used to pre-resolve
   * node-level style references.
   */
  readonly styleRegistry: FigStyleRegistry;
};

/** Read the bytes of a fig file and assemble its raw tree view. */
export async function loadFigSource(buffer: Uint8Array): Promise<FigSource> {
  const loaded = await loadFigFile(buffer);
  const rawTree = buildNodeTree(loaded.nodeChanges);
  const rawNodesByGuid = indexRawNodes(rawTree);
  const styleRegistry = buildFigStyleRegistry(rawNodesByGuid);
  const resolvedRoots = rawTree.roots.map((root) => resolveTree(root, styleRegistry));
  const tree: NodeTreeResult = { ...rawTree, roots: resolvedRoots };
  const nodesByGuid = indexResolvedNodes(resolvedRoots);
  return { loaded, tree, nodesByGuid, styleRegistry };
}

function indexRawNodes(tree: NodeTreeResult): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const root of tree.roots) {
    walk(root, out);
  }
  return out;
}

function indexResolvedNodes(roots: readonly FigNode[]): ReadonlyMap<string, FigNode> {
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
 * Recursively rebuild a node with style-id resolution applied at every
 * level. The original immutable tree is preserved; we only allocate
 * new wrapper objects when a node (or any descendant) actually changes,
 * keeping memory pressure proportional to the styled-node count rather
 * than the full tree size.
 *
 * In addition to node-level `styleIdForFill` / `styleIdForStrokeFill`,
 * this also resolves the per-character `styleIdForFill` references
 * inside `textData.styleOverrideTable[]`. The renderer's
 * `text/runs/resolve.ts` does the same lookup at render time; doing it
 * once at load keeps the emitter ignorant of the registry while still
 * producing the same per-run colours as the SVG renderer.
 */
function resolveTree(node: FigNode, registry: FigStyleRegistry): FigNode {
  const styleResolved = resolveNodeStyleIds(node, registry);
  const textResolved = resolveTextOverrides(styleResolved, registry);
  const rawChildren = node.children;
  if (!rawChildren || rawChildren.length === 0) {
    return textResolved;
  }
  const newChildren = rawChildren.map((child) => {
    if (!child) { return child; }
    return resolveTree(child, registry);
  });
  const childrenChanged = newChildren.some((child, i) => child !== rawChildren[i]);
  if (!childrenChanged && textResolved === node) {
    return node;
  }
  return { ...textResolved, children: newChildren } as FigNode;
}

type TextOverrideEntry = {
  readonly styleID: number;
  readonly styleIdForFill?: { readonly guid?: { readonly sessionID: number; readonly localID: number }; readonly assetRef?: { readonly key: string } };
  readonly fillPaints?: readonly FigPaint[];
  readonly [key: string]: unknown;
};

type RawTextDataLike = {
  readonly characters?: string;
  readonly characterStyleIDs?: readonly number[];
  readonly styleOverrideTable?: readonly TextOverrideEntry[];
  readonly [key: string]: unknown;
};

/**
 * Walk a TEXT node's `styleOverrideTable` and replace each entry's
 * `fillPaints` cache with the registry-resolved value when its
 * `styleIdForFill` reference resolves through the document-wide
 * style registry.
 *
 * Routes through the same `resolveStyledPaint` SoT used by every
 * other style-resolution site (renderer node fills, scene-graph
 * INSTANCE merge, vector per-path overrides, text-run resolver).
 * Registry wins over inline `fillPaints` when the ref resolves —
 * otherwise the inline cache stays in place (matching Figma's
 * actual rendering of dangling refs).
 *
 * Returns the original node when no entry needed updating. Both
 * `node.textData.styleOverrideTable` (the typed wrapper shape used
 * by some FigNode flows) and the top-level `styleOverrideTable`
 * (the raw Kiwi field) are checked so this works regardless of
 * which channel the parser populated.
 */
function resolveTextOverrides(node: FigNode, registry: FigStyleRegistry): FigNode {
  if (node.type?.name !== "TEXT") {
    return node;
  }
  const tdSrc = (node as Record<string, unknown>).textData as RawTextDataLike | undefined;
  const fromTextData = tdSrc?.styleOverrideTable;
  const fromNode = (node.styleOverrideTable as readonly TextOverrideEntry[] | undefined);
  const sot = fromTextData ?? fromNode;
  if (!sot || sot.length === 0) {
    return node;
  }
  const newSot = sot.map((entry): TextOverrideEntry => {
    const resolved = resolveStyledPaint(entry.styleIdForFill, entry.fillPaints, registry);
    if (resolved === undefined) { return entry; }
    if (resolved === entry.fillPaints) { return entry; }
    return { ...entry, fillPaints: resolved };
  });
  const changed = newSot.some((entry, i) => entry !== sot[i]);
  if (!changed) {
    return node;
  }
  if (fromTextData) {
    const newTd: RawTextDataLike = { ...tdSrc, styleOverrideTable: newSot };
    return { ...node, textData: newTd } as FigNode;
  }
  return { ...node, styleOverrideTable: newSot } as FigNode;
}

/** Locate the user-visible CANVAS with the given name (typically "Design"). */
export function findCanvas(source: FigSource, canvasName: string): FigNode | undefined {
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of safeChildren(root)) {
      if (canvas.name === canvasName && canvas.internalOnly !== true) {
        return canvas;
      }
    }
  }
  return undefined;
}

/** Locate the (single) Internal Only Canvas — Figma's holder for shared style proxies. */
export function findInternalCanvas(source: FigSource): FigNode | undefined {
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of safeChildren(root)) {
      if (canvas.internalOnly === true) {
        return canvas;
      }
    }
  }
  return undefined;
}
