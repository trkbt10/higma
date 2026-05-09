/**
 * @file FigSymbolContext — single source of truth for "loaded fig + every
 * map a downstream consumer needs to resolve symbols, styles, and INSTANCE
 * overrides against it".
 *
 * ## Why this exists
 *
 * Before this module, every consumer of a loaded `.fig` file rebuilt the
 * same maps in slightly different ways:
 *
 *   - `renderFigToSvg` accepted an *optional* raw `symbolMap`. When tests
 *     forgot to pass it, INSTANCE resolution silently returned empty
 *     children, leading to confusing "buildNodeTree returned a nodeMap but
 *     the renderer wants a symbolMap" reports.
 *   - `@higma-tools/fig-to-web` and `@higma-tools/refine-fig` each defined
 *     a `loadFigSource` / `loadRefineSource` that called `buildNodeTree`,
 *     re-walked the roots into a `nodesByGuid`, built a style registry,
 *     and recursively applied the registry to every node. The two helpers
 *     were ~95 % identical.
 *   - `render-frames.ts`, `render-node-worker.ts`, `structure-diff/diff.ts`
 *     each carried their own `indexNodes` / `walk` pair, all duplicating
 *     `buildNodeTree`'s already-returned `nodeMap`.
 *
 * The fan-out meant every change to symbol/style resolution had to be
 * mirrored in N places, which never happened cleanly. `FigSymbolContext`
 * collapses all of those duplicates into a single value object built once
 * from a `LoadedFigFile` and consumed everywhere downstream.
 *
 * ## Layering
 *
 * The user's invariant is: **parser → context → (builder | renderer)**.
 *
 *   - `parser` (`@higma-document-io/fig/roundtrip`) produces
 *     `LoadedFigFile` from raw bytes.
 *   - `context` (this module) turns a `LoadedFigFile` into a
 *     `FigSymbolContext` — every subsequent consumer reads from this
 *     context and never re-derives.
 *   - `builder` (e.g. `@higma-tools/fig-to-web`) and `renderer`
 *     (`@higma-document-renderers/fig`) consume the context.
 *
 * The context lives in `@higma-document-io/fig/context` because it is the
 * downstream face of the IO layer — the domain SoT helpers
 * (`buildNodeTree`, `buildFigStyleRegistry`, `resolveNodeStyleIds`,
 * `resolveStyledPaint`) all live in `@higma-document-models/fig`, and this
 * module composes them. Renderers, tools, and bridges depend on this one
 * module instead of re-orchestrating them.
 *
 * ## Names
 *
 * `nodesByGuid` and `symbolMap` point at the **same** `Map`. The two
 * names exist because the call-site vocabulary differs:
 *
 *   - `nodesByGuid` is what tool packages already used for "lookup any
 *     node by GUID string".
 *   - `symbolMap` is what the renderer + symbol-resolver SoT API expects
 *     for "give me the SYMBOL backing this INSTANCE".
 *
 * Both names route to the same Map instance — there is no separate
 * "symbol-only" map. INSTANCE resolution looks for the SYMBOL by GUID
 * via `resolveSymbolGuidStr`, which only consults entries that turn out
 * to be SYMBOLs; passing the full nodeMap is correct and matches the
 * contract `convertFigNode` already requires.
 */

import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import type {
  FigBlob,
  FigStyleRegistry,
  LoadedFigFile,
  NodeTreeResult,
} from "@higma-document-models/fig/domain";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import {
  buildNodeTree,
  EMPTY_FIG_STYLE_REGISTRY,
  getNodeType,
  guidToString,
  safeChildren,
} from "@higma-document-models/fig/domain";
import {
  buildFigStyleRegistry,
  resolveNodeStyleIds,
  resolveStyledPaint,
} from "@higma-document-models/fig/symbols";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

/**
 * Single source of truth for a loaded `.fig` file plus every derived map
 * a downstream consumer needs.
 *
 * A `FigSymbolContext` is read-only. It is created once per `.fig` load
 * and shared by every consumer (builder, renderer, refine pipeline,
 * web-fig bridge) that touches that file. Re-deriving any of these maps
 * outside this module is a SoT violation — extend the context instead.
 */
export type FigSymbolContext = {
  /**
   * The full roundtrip state. Held so `saveFigFile` / `applyPlan` flows
   * can mutate `loaded.nodeChanges` in place without re-loading.
   */
  readonly loaded: LoadedFigFile;

  /**
   * Reconstructed parent-child tree built from `loaded.nodeChanges`.
   * `tree.roots` is the entry point for tree walks; `tree.nodeMap` is the
   * raw, pre-style-resolution lookup.
   */
  readonly tree: NodeTreeResult;

  /**
   * Resolved-tree roots. Every `fillPaints` / `strokePaints` reference on
   * a node has been replaced with the paint resolved through
   * `styleRegistry`. Walk these instead of `tree.roots` whenever the
   * downstream consumer needs the live colour the renderer would draw.
   */
  readonly roots: readonly FigNode[];

  /**
   * `sessionID:localID` → resolved FigNode. Built from `roots` (post style
   * resolution) so a single GUID lookup gives the same node a renderer
   * would walk. Same Map instance as `symbolMap`.
   */
  readonly nodesByGuid: ReadonlyMap<string, FigNode>;

  /**
   * Alias of `nodesByGuid` exposing the renderer's vocabulary. The
   * symbol resolver (`resolveInstanceNode`) and `convertFigNode` consume
   * a `ReadonlyMap<string, FigNode>` keyed by the SYMBOL's GUID; the full
   * nodeMap is the correct value because lookups only consult entries
   * that happen to be SYMBOLs.
   */
  readonly symbolMap: ReadonlyMap<string, FigNode>;

  /** Document-wide style registry resolved from `tree.nodeMap`. */
  readonly styleRegistry: FigStyleRegistry;

  /** Binary blobs — alias of `loaded.blobs` exposed for ergonomics. */
  readonly blobs: readonly FigBlob[];

  /** Images — alias of `loaded.images` exposed for ergonomics. */
  readonly images: ReadonlyMap<string, FigPackageImage>;

  /** Metadata — alias of `loaded.metadata` exposed for ergonomics. */
  readonly metadata: FigPackageMetadata | null;
};

/** Build a `FigSymbolContext` from a buffer of raw `.fig` bytes. */
export async function createFigSymbolContext(buffer: Uint8Array): Promise<FigSymbolContext> {
  const loaded = await loadFigFile(buffer);
  return createFigSymbolContextFromLoaded(loaded);
}

/**
 * Build a `FigSymbolContext` from a pre-loaded file (e.g. produced by
 * `loadFigFile` directly when the caller needs to inspect it before
 * deriving the context).
 */
export function createFigSymbolContextFromLoaded(loaded: LoadedFigFile): FigSymbolContext {
  const tree = buildNodeTree(loaded.nodeChanges);
  // Build the style registry against the raw, pre-resolved tree —
  // resolution depends on `styleIdForFill` references which are present
  // before any tree walk re-applies them.
  const rawByGuid = indexResolved(tree.roots);
  const styleRegistry = rawByGuid.size > 0 ? buildFigStyleRegistry(rawByGuid) : EMPTY_FIG_STYLE_REGISTRY;
  // Resolve every node's `fillPaints` / `strokePaints` (and per-text-run
  // `fillPaints`) through the style registry, so downstream consumers
  // reading `node.fillPaints` see the live paint a renderer would draw.
  const resolvedRoots = tree.roots.map((root) => resolveSubtree(root, styleRegistry));
  const nodesByGuid = indexResolved(resolvedRoots);

  return {
    loaded,
    tree: { ...tree, roots: resolvedRoots },
    roots: resolvedRoots,
    nodesByGuid,
    symbolMap: nodesByGuid,
    styleRegistry,
    blobs: loaded.blobs,
    images: loaded.images,
    metadata: loaded.metadata,
  };
}

/**
 * SoT for "walk a forest of FigNode roots and index every node by
 * GUID string". Replaces five copies of the same recursive `walk` helper
 * across `@higma-tools/fig-to-web/fig-source/load`,
 * `@higma-tools/refine-fig/refine-source/load`,
 * `@higma-tools/refine-fig/visual/render-frames`,
 * `@higma-tools/refine-fig/visual/render-node-worker`, and
 * `@higma-tools/refine-fig/structure-diff/diff`.
 */
function indexResolved(roots: readonly FigNode[]): ReadonlyMap<string, FigNode> {
  const out = new Map<string, FigNode>();
  for (const root of roots) {
    walkInto(root, out);
  }
  return out;
}

function walkInto(node: FigNode, out: Map<string, FigNode>): void {
  if (node.guid) {
    out.set(guidToString(node.guid), node);
  }
  for (const child of safeChildren(node)) {
    walkInto(child, out);
  }
}

/**
 * Recursive immutable rebuild that replaces every node's
 * `fillPaints` / `strokePaints` (and, for TEXT nodes, the per-character
 * style table's `fillPaints`) with the registry-resolved paint.
 *
 * Cost is proportional to the count of *styled* nodes — children whose
 * subtrees did not change return the same reference, so unstyled
 * branches share storage with the input.
 */
function resolveSubtree(node: FigNode, registry: FigStyleRegistry): FigNode {
  const styleResolved = resolveNodeStyleIds(node, registry);
  const textResolved = resolveTextStyleOverrides(styleResolved, registry);
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
  return { ...textResolved, children: newChildren } as FigNode;
}

/**
 * TEXT nodes carry a per-character style table whose entries may
 * reference shared `styleIdForFill`. The renderer's text-run resolver
 * reads those through the registry; pre-resolving here keeps tools that
 * read `entry.fillPaints` directly aligned with renderer output.
 *
 * Both `node.textData.styleOverrideTable` (typed) and the top-level
 * `node.styleOverrideTable` (raw Kiwi) are checked, mirroring the legacy
 * `fig-source` helper exactly.
 */
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

function resolveTextStyleOverrides(node: FigNode, registry: FigStyleRegistry): FigNode {
  if (getNodeType(node) !== "TEXT") {
    return node;
  }
  const tdSrc = (node as Record<string, unknown>).textData as RawTextDataLike | undefined;
  const fromTextData = tdSrc?.styleOverrideTable;
  const fromNode = node.styleOverrideTable as readonly TextOverrideEntry[] | undefined;
  const sot = fromTextData ?? fromNode;
  if (!sot || sot.length === 0) {
    return node;
  }
  const newSot = sot.map((entry): TextOverrideEntry => {
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
  if (fromTextData) {
    const newTd: RawTextDataLike = { ...tdSrc, styleOverrideTable: newSot };
    return { ...node, textData: newTd } as FigNode;
  }
  return { ...node, styleOverrideTable: newSot } as FigNode;
}
