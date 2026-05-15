/**
 * @file Main SVG renderer for Figma nodes
 *
 * This is the SSoT entry point for rendering `FigNode` trees to SVG.
 * It routes through the unified pipeline used by all backends:
 *
 *   FigNode[] → convertFigNode → FigDesignNode[]
 *             → buildSceneGraph → SceneGraph
 *             → resolveRenderTree → RenderTree
 *             → formatRenderTreeToSvg → SVG string
 *
 * The RenderTree is the format-agnostic intermediate representation shared
 * with the React and WebGL backends. Having one pipeline means any change
 * to rendering semantics (effects, masks, strokes, gradients, etc.) is made
 * in a single place (`scene-graph/render-tree/resolve.ts`) and all backends
 * inherit it.
 *
 * ## Input contract
 *
 * `renderFigToSvg` requires the caller to supply canvas dimensions and a
 * full set of source assets (blobs, images, and — when INSTANCE nodes are
 * present — the raw `symbolMap`). There are no implicit defaults: a missing
 * `blobs` array is not the same as "empty blobs", and a missing canvas size
 * is not `800x600`. If you don't have these, use `renderCanvas` (which
 * derives the size from the canvas children) or compute them explicitly.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigSvgRenderResult } from "../types";
import type { SvgString } from "./primitives";
import type { FontLoader, FontQuery } from "@higma-document-models/fig/font";
import { collectFontQueries, preloadFonts, fontQueryKey } from "@higma-document-models/fig/font";
import { createCachedTextFontResolver, type TextFontResolver } from "../text/rendering";
import type { FigDesignNode, FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigmaRenderExportSettings } from "../scene-graph/render";
import { convertFigNode, EMPTY_FIG_STYLE_REGISTRY } from "@higma-document-models/fig/domain";
import { buildFigStyleRegistry } from "@higma-document-models/fig/symbols";
import { buildSceneGraph } from "../scene-graph/builder";
import { pruneSceneGraphToViewport } from "../scene-graph/viewport-prune";
import { resolveRenderTree } from "../scene-graph/render-tree";
import { formatRenderTreeToSvg } from "./scene-renderer";

// =============================================================================
// Transform Normalization
// =============================================================================

/**
 * Get the minimum (x, y) of all root node translations.
 *
 * `?? 0` on m02/m12 reflects the Kiwi binary schema: an omitted translation
 * field encodes the value 0 (the identity translation). This is a schema
 * invariant, not a runtime recovery path.
 */
function getRootFrameOffset(nodes: readonly FigNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0 };
  }

  const { minX, minY } = nodes.reduce(
    (acc, node) => {
      const transform = node.transform;
      if (transform) {
        return {
          minX: Math.min(acc.minX, transform.m02 ?? 0),
          minY: Math.min(acc.minY, transform.m12 ?? 0),
        };
      }
      return acc;
    },
    { minX: Infinity, minY: Infinity },
  );

  return {
    x: isFinite(minX) ? minX : 0,
    y: isFinite(minY) ? minY : 0,
  };
}

/**
 * Normalize a FigDesignNode's transform by removing the root offset.
 */
function normalizeDesignNodeTransform(node: FigDesignNode, offset: { x: number; y: number }): FigDesignNode {
  if (offset.x === 0 && offset.y === 0) {
    return node;
  }
  return {
    ...node,
    transform: {
      ...node.transform,
      m02: node.transform.m02 - offset.x,
      m12: node.transform.m12 - offset.y,
    },
  };
}

// =============================================================================
// Render Options
// =============================================================================

/**
 * Required inputs for rendering Figma nodes to SVG.
 *
 * Every field here represents information that cannot be invented by the
 * renderer — the caller must supply it or the render is undefined.
 */
export type FigSvgRenderOptions = {
  /** Canvas width in SVG user units. */
  readonly width: number;
  /** Canvas height in SVG user units. */
  readonly height: number;
  /** World-space viewport rendered into the supplied canvas dimensions. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Binary blobs from the parsed .fig file (required for path geometry). */
  readonly blobs: readonly FigBlob[];
  /** Image map from the parsed .fig file (required for IMAGE paints). */
  readonly images: ReadonlyMap<string, FigPackageImage>;
  /** Optional background color (CSS color string). */
  readonly backgroundColor?: string;
  /** Translate roots so the top-left is at (0, 0). */
  readonly normalizeRootTransform?: boolean;
  /** Include nodes with `visible: false` (for style inspection views). */
  readonly showHiddenNodes?: boolean;
  /**
   * Raw `sessionID:localID → FigNode` map. Required for INSTANCE
   * resolution: every INSTANCE node looks up its referenced SYMBOL
   * here. Inputs that are guaranteed to contain no INSTANCE nodes pass
   * `new Map()` to make the absence explicit.
   *
   * Production callers should obtain this from
   * `FigSymbolContext.symbolMap`
   * (`@higma-document-io/fig/context`) — that context is the SoT for
   * "loaded fig + every map a downstream consumer needs". Building the
   * map ad-hoc at the call site (e.g. by re-walking `tree.roots`) is a
   * SoT violation and historically caused divergent results when one
   * call site applied style resolution and another did not.
   */
  readonly symbolMap: ReadonlyMap<string, FigNode>;
  /**
   * Pre-built document-wide style registry. Optional — when omitted,
   * the renderer derives one from `symbolMap` via
   * `buildFigStyleRegistry`.
   *
   * Production callers that have a `FigSymbolContext` should pass
   * `ctx.styleRegistry` to skip re-derivation. This is a passthrough
   * field, not a way to inject a different registry: the SoT for
   * "what shared styles exist in this document" is the registry the
   * IO context built. The renderer accepts it here purely to amortise
   * the build across multiple per-frame renders of the same file.
   */
  readonly styleRegistry?: FigStyleRegistry;
  /** Explicit font loader used to preload TEXT fonts before scene-graph resolution. */
  readonly fontLoader?: FontLoader;
  /**
   * Export-time rendering settings that control how Figma image paints
   * are decoded and re-encoded (color profile, image resampling, PDF
   * quality). The renderer never invents these — when an image paint
   * carries `imageShouldColorManage: true` and the caller has not set
   * `exportSettings.colorProfile`, conversion fails fast in
   * `requireManagedImageColorProfile`. SVG callers targeting a normal
   * web browser viewport should pass `{ colorProfile: "SRGB" }`
   * explicitly; callers targeting Display P3 must additionally provide
   * `displayP3IccProfile` bytes.
   */
  readonly exportSettings?: FigmaRenderExportSettings;
};

/**
 * Walk every TEXT node and collect the unique `FontQuery`s that the
 * renderer will demand from the resolver — both the base font and every
 * per-character override entry. Dedupe via the canonical `fontQueryKey`
 * so the preload set, the resolver lookups, and the cache all agree.
 */
function collectTextFontQueries(
  nodes: readonly FigDesignNode[],
  symbolMap?: ReadonlyMap<string, FigDesignNode>,
): readonly FontQuery[] {
  // Tree walk + override + INSTANCE recursion is the canonical SoT in
  // `@higma-document-models/fig/font/context`. Re-implementing it
  // here would drift on edge cases (override fonts in symbols,
  // cyclic INSTANCE references) the SoT spec already covers.
  return collectFontQueries({ roots: nodes, symbolMap }).queries;
}

async function createPreloadedTextFontResolver(
  nodes: readonly FigDesignNode[],
  fontLoader: FontLoader | undefined,
  symbolMap?: ReadonlyMap<string, FigDesignNode>,
): Promise<TextFontResolver | undefined> {
  if (fontLoader === undefined) {
    return undefined;
  }
  const queries = collectTextFontQueries(nodes, symbolMap);
  // `preloadFonts` (SoT) loads each query, throws on failure when no
  // fallback chain is configured — exactly the renderer's no-fallback
  // policy. The returned `cache` is keyed by `fontQueryKey`.
  const result = await preloadFonts({ queries, loader: fontLoader });
  return createCachedTextFontResolver({
    getCachedFont: (query) => {
      const loaded = result.cache.get(fontQueryKey(query));
      if (loaded === undefined) {
        throw new Error(`renderFigToSvg: text font resolver was not preloaded for "${query.family}" weight ${query.weight} style ${query.style}`);
      }
      return loaded;
    },
  });
}

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Convert every entry of a FigNode symbolMap to a FigDesignNode, using the
 * same styleRegistry so symbols and instance roots resolve their fills/
 * strokes through the identical registry path. All entries must be converted
 * (not only the directly referenced ones) because nested INSTANCE resolution
 * in `buildSceneGraph` walks the converted map; any entry missed here would
 * surface as an "INSTANCE symbol not found" warning.
 */
function convertSymbolMap(
  symbolMap: ReadonlyMap<string, FigNode>,
  components: Map<string, FigDesignNode>,
  styleRegistry: FigStyleRegistry,
  blobs: readonly FigBlob[] | undefined,
): ReadonlyMap<string, FigDesignNode> {
  const out = new Map<string, FigDesignNode>();
  for (const [key, node] of symbolMap) {
    // Pass the raw symbolMap so per-node INSTANCE override GUIDs are
    // translated into the SYMBOL-descendant namespace during conversion.
    // Without this, nested INSTANCE overrides inside SYMBOL definitions
    // (rare but present) silently drop their overrides.
    // `blobs` enables fillGeometry-based size disambiguation during
    // GUID translation (multi-avatar sibling case).
    out.set(key, convertFigNode(node, components, styleRegistry, symbolMap, blobs));
  }
  return out;
}

/**
 * Render Figma nodes to SVG.
 */
export async function renderFigToSvg(
  nodes: readonly FigNode[],
  options: FigSvgRenderOptions,
): Promise<FigSvgRenderResult> {
  const { width, height, blobs, images } = options;
  const warnings: string[] = [];

  // Style registry resolves styleIdForFill/styleIdForStrokeFill references
  // during `convertFigNode`, and is also passed to buildSceneGraph for
  // per-path vector style overrides.
  //
  // Production callers (figma-svg, render-frames, render-node, etc.)
  // pass `options.styleRegistry` from a `FigSymbolContext` — that context
  // already built one when the file was loaded, so re-deriving here would
  // duplicate work. When the caller omits it, we fall back to building
  // from the raw symbolMap; an empty symbolMap (no INSTANCE/no styles)
  // yields the empty registry constant.
  const rawSymbolMap = options.symbolMap;
  const styleRegistry: FigStyleRegistry = (() => {
    if (options.styleRegistry !== undefined) {
      return options.styleRegistry;
    }
    if (rawSymbolMap.size > 0) {
      return buildFigStyleRegistry(rawSymbolMap);
    }
    return EMPTY_FIG_STYLE_REGISTRY;
  })();

  // Convert all parser nodes (including symbol definitions) into domain
  // objects. `components` is populated as a side-effect by convertFigNode
  // whenever it encounters a SYMBOL (the on-disk encoding of the Figma
  // UI concept "Component"; the canonical schema has no COMPONENT or
  // COMPONENT_SET NodeType — see
  // `docs/refactor/component-type-cleanup.md`).
  const components = new Map<string, FigDesignNode>();
  const designSymbolMap = convertSymbolMap(rawSymbolMap, components, styleRegistry, blobs);

  const designNodes: FigDesignNode[] = nodes.map((n) => convertFigNode(n, components, styleRegistry, rawSymbolMap, blobs));

  // Merge symbol definitions discovered while converting root nodes with
  // those that came via the symbolMap option. Later entries (from the
  // explicit symbolMap) win — they are the authoritative ones.
  const mergedSymbolMap = new Map<string, FigDesignNode>(components);
  for (const [key, node] of designSymbolMap) {
    mergedSymbolMap.set(key, node);
  }

  // Optional root transform normalization. Offsets are computed from the
  // raw FigNode transforms (pre-conversion); apply the same offset to each
  // corresponding converted FigDesignNode. Both arrays are in the same
  // order because `designNodes` is produced by `nodes.map(convertFigNode)`.
  const normalizedNodes = (() => {
    if (options.normalizeRootTransform) {
      const offset = getRootFrameOffset(nodes);
      return designNodes.map((n) => normalizeDesignNodeTransform(n, offset));
    }
    return designNodes;
  })();
  const textFontResolver = await createPreloadedTextFontResolver(normalizedNodes, options.fontLoader, mergedSymbolMap);

  const sceneGraph = buildSceneGraph(normalizedNodes, {
    blobs,
    images,
    canvasSize: { width, height },
    viewport: options.viewport ?? { x: 0, y: 0, width, height },
    symbolMap: mergedSymbolMap,
    showHiddenNodes: options.showHiddenNodes === true,
    styleRegistry,
    warnings,
    textFontResolver,
  });

  // Drop subtrees whose world-space bbox lies entirely outside the
  // viewport. The visible output is unchanged (the root viewport clip
  // already hides those subtrees), but the pruned SVG is one to two
  // orders of magnitude smaller for documents with off-viewport
  // content, and downstream rasterisers (notably resvg) no longer
  // panic on masked subtrees translated past the viewport. See
  // `viewport-prune.ts` for the SoT docstring.
  const prunedSceneGraph = pruneSceneGraphToViewport(sceneGraph);

  const renderTree = resolveRenderTree(prunedSceneGraph, { exportSettings: options.exportSettings });
  const svgOutput: SvgString = formatRenderTreeToSvg(renderTree, {
    backgroundColor: options.backgroundColor,
  });

  return {
    svg: svgOutput,
    warnings,
  };
}

// =============================================================================
// Canvas Convenience Wrapper
// =============================================================================

/**
 * Options for `renderCanvas`. Width/height are derived from the canvas
 * children unless overridden, and root transforms are always normalized to
 * (0, 0) — that behaviour is the defining characteristic of a "canvas"
 * render and is not optional. Callers that need absolute-coordinate output
 * must use `renderFigToSvg` directly.
 */
export type FigCanvasRenderOptions = Omit<FigSvgRenderOptions, "width" | "height" | "normalizeRootTransform"> & {
  /** Override the derived canvas width. */
  readonly width?: number;
  /** Override the derived canvas height. */
  readonly height?: number;
};

/**
 * Compute canvas bounds from the extent of its children. Throws when no
 * child has a transform + size — an unmeasurable canvas has no default we
 * can safely invent.
 */
function calculateCanvasBounds(children: readonly FigNode[]): { width: number; height: number } {
  const bounds = children.reduce(
    (acc, child) => {
      const { transform, size } = child;
      if (transform && size) {
        // m02/m12/x/y can be omitted in the Kiwi binary schema, which the
        // schema defines as 0 — treat them as such when computing extent.
        const right = (transform.m02 ?? 0) + (size.x ?? 0);
        const bottom = (transform.m12 ?? 0) + (size.y ?? 0);
        return {
          width: Math.max(acc.width, right),
          height: Math.max(acc.height, bottom),
          measured: true,
        };
      }
      return acc;
    },
    { width: 0, height: 0, measured: false },
  );

  if (!bounds.measured) {
    throw new Error(
      "renderCanvas: cannot derive canvas size — no child has both `transform` and `size`. Pass explicit `width`/`height`.",
    );
  }
  return { width: bounds.width, height: bounds.height };
}

/**
 * Render a single canvas (page) from Figma nodes. Width/height are derived
 * from the extent of the canvas children unless overridden. The root
 * transforms are normalized to (0, 0) by default since canvas rendering
 * typically targets a self-contained viewport.
 */
export async function renderCanvas(
  canvasNode: Pick<FigNode, "children">,
  options: FigCanvasRenderOptions,
): Promise<FigSvgRenderResult> {
  // `.children` is optional in the parser type (kiwi-level "no value"); an
  // absent array is semantically an empty canvas, not an error.
  const children = canvasNode.children?.filter((c): c is FigNode => c != null) ?? [];

  const explicitW = options.width;
  const explicitH = options.height;

  const canvasSize = (() => {
    if (explicitW !== undefined && explicitH !== undefined) {
      return { width: explicitW, height: explicitH };
    }
    const bounds = calculateCanvasBounds(children);
    return { width: explicitW ?? bounds.width, height: explicitH ?? bounds.height };
  })();
  const { width, height } = canvasSize;

  return renderFigToSvg(children, {
    ...options,
    width,
    height,
    // Canvas rendering always normalizes root transforms to (0, 0). This
    // is the defining characteristic of the `renderCanvas` entry point —
    // see the FigCanvasRenderOptions docstring. Callers that need absolute
    // coordinates must use `renderFigToSvg` directly.
    normalizeRootTransform: true,
  });
}
