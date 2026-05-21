/**
 * @file Main SVG renderer for Figma nodes
 *
 * This is the SSoT entry point for rendering Kiwi `FigNode` documents to SVG.
 * It routes through the unified pipeline used by all backends:
 *
 *   FigNode[] → buildSceneGraph → SceneGraph
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
 * full set of source assets (blobs, images, document children, style
 * registry, and SymbolResolver). There are no implicit defaults: a missing
 * `blobs` array is not the same as "empty blobs", and a missing canvas size
 * is not `800x600`. If you don't have these, use `renderCanvas` (which
 * derives the size from the canvas children) or compute them explicitly.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import type { FigBlob, FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigSvgRenderResult } from "../types";
import type { SvgString } from "./primitives";
import type { FontLoader, FontQuery } from "@higma-document-models/fig/font";
import { collectFontQueries, preloadFonts, fontQueryKey } from "@higma-document-models/fig/font";
import { createCachedTextFontResolver, type TextFontResolver } from "../text";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { SymbolResolver } from "@higma-document-models/fig/symbols";
import { buildSceneGraph, pruneSceneGraphToViewport, resolveRenderTree, type FigmaRenderExportSettings } from "../scene-graph";
import { formatRenderTreeToSvg } from "./scene-renderer";

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
  readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Binary blobs from the parsed .fig file (required for path geometry). */
  readonly blobs: readonly FigBlob[];
  /** Image map from the parsed .fig file (required for IMAGE paints). */
  readonly images: ReadonlyMap<string, FigPackageImage>;
  /** Optional background color (CSS color string). */
  readonly backgroundColor?: string;
  /** Include nodes with `visible: false` (for style inspection views). */
  readonly showHiddenNodes?: boolean;
  /** Parent/child view over the Kiwi document. */
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  /** SymbolResolver is the only authority for INSTANCE resolution. */
  readonly symbolResolver: SymbolResolver;
  /** Document-wide style registry. */
  readonly styleRegistry: FigStyleRegistry;
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
  nodes: readonly FigNode[],
  symbolResolver: SymbolResolver,
  childrenOf: (node: FigNode) => readonly FigNode[],
): readonly FontQuery[] {
  return collectFontQueries({ roots: nodes, symbolResolver, childrenOf }).queries;
}

async function createPreloadedTextFontResolver(
  nodes: readonly FigNode[],
  fontLoader: FontLoader | undefined,
  symbolResolver: SymbolResolver,
  childrenOf: (node: FigNode) => readonly FigNode[],
): Promise<TextFontResolver | undefined> {
  if (fontLoader === undefined) {
    return undefined;
  }
  const queries = collectTextFontQueries(nodes, symbolResolver, childrenOf);
  // `preloadFonts` (SoT) loads each query, throws on failure when no
  // substitution chain is configured — exactly the renderer's no-
  // substitution policy. The returned `cache` is keyed by `fontQueryKey`.
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
 * Render Figma nodes to SVG.
 */
export async function renderFigToSvg(
  nodes: readonly FigNode[],
  options: FigSvgRenderOptions,
): Promise<FigSvgRenderResult> {
  const { width, height, blobs, images } = options;
  const warnings: string[] = [];

  const textFontResolver = await createPreloadedTextFontResolver(
    nodes,
    options.fontLoader,
    options.symbolResolver,
    options.childrenOf,
  );

  const sceneGraph = buildSceneGraph(nodes, {
    blobs,
    images,
    canvasSize: { width, height },
    viewport: options.viewport,
    symbolResolver: options.symbolResolver,
    childrenOf: options.childrenOf,
    showHiddenNodes: options.showHiddenNodes === true,
    styleRegistry: options.styleRegistry,
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
    figmaEmptyFrameIndicator: shouldEmitFigmaEmptyFrameIndicator(nodes),
  });

  return {
    svg: svgOutput,
    warnings,
  };
}

/**
 * Mirror Figma's SVG-exporter behaviour for "empty" frames: when the
 * single root of an export is a FRAME with no visible paint at all,
 * Figma prepends a 1-px purple dashed rectangle as a visual cue that
 * the frame interior has no surface. The indicator is keyed off the
 * raw `FigNode`'s type-name and paint arrays — the data the .fig file
 * itself carries — so this is a renderer-wide rule, not specialised
 * to any single template.
 *
 * Both fillPaints and strokePaints participate: a frame with a
 * visible stroke (e.g. a user-drawn dashed-purple outline frame)
 * already has its own visible border, so Figma does not stack the
 * synthetic indicator on top — that would double-draw the same
 * dashed-purple chrome.
 *
 * SYMBOL/COMPONENT roots never receive the indicator (Figma's
 * exporter treats them as their own self-contained artifact, not as
 * a layout frame). Multi-root exports also skip it — Figma's
 * exporter only emits the indicator when there is a single
 * exporter root to outline.
 */
function shouldEmitFigmaEmptyFrameIndicator(nodes: readonly FigNode[]): boolean {
  if (nodes.length !== 1) { return false; }
  const root = nodes[0];
  if (getNodeType(root) !== "FRAME") { return false; }
  const fills = root.fillPaints ?? [];
  const strokes = root.strokePaints ?? [];
  const noVisibleFill = fills.every((f) => f.visible === false);
  const noVisibleStroke = strokes.every((s) => s.visible === false);
  return noVisibleFill && noVisibleStroke;
}

// =============================================================================
// Canvas Convenience Wrapper
// =============================================================================

/**
 * Options for `renderCanvas`. Width/height are derived from the canvas
 * children unless overridden, and the viewport is anchored at the minimum
 * root translation. The Kiwi node transforms are never rewritten. Callers
 * that need a different world-space viewport
 * must use `renderFigToSvg` directly.
 */
export type FigCanvasRenderOptions = Omit<FigSvgRenderOptions, "width" | "height" | "viewport"> & {
  /** Override the derived canvas width. */
  readonly width?: number;
  /** Override the derived canvas height. */
  readonly height?: number;
};

type CanvasBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type ResolvedCanvasSize = {
  readonly width: number;
  readonly height: number;
  readonly viewport: CanvasBounds;
};

/**
 * Compute canvas bounds from the extent of its children. Throws when no
 * child has a transform + size — an unmeasurable canvas has no default we
 * can safely invent.
 */
function calculateCanvasBounds(
  children: readonly FigNode[],
): CanvasBounds {
  const bounds = children.reduce(
    (acc, child) => {
      const { transform, size } = child;
      if (transform && size) {
        // m02/m12/x/y can be omitted in the Kiwi binary schema, which the
        // schema defines as 0 — treat them as such when computing extent.
        const x = transform.m02 ?? 0;
        const y = transform.m12 ?? 0;
        const right = x + (size.x ?? 0);
        const bottom = y + (size.y ?? 0);
        return {
          minX: Math.min(acc.minX, x),
          minY: Math.min(acc.minY, y),
          maxX: Math.max(acc.maxX, right),
          maxY: Math.max(acc.maxY, bottom),
          measured: true,
        };
      }
      return acc;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, measured: false },
  );

  if (!bounds.measured) {
    throw new Error(
      "renderCanvas: cannot derive canvas size — no child has both `transform` and `size`. Pass explicit `width`/`height`.",
    );
  }
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function resolveCanvasSize(
  children: readonly FigNode[],
  explicitW: number | undefined,
  explicitH: number | undefined,
): ResolvedCanvasSize {
  const bounds = calculateCanvasBounds(children);
  if (explicitW !== undefined && explicitH !== undefined) {
    return {
      width: explicitW,
      height: explicitH,
      viewport: { x: bounds.x, y: bounds.y, width: explicitW, height: explicitH },
    };
  }
  const width = explicitW ?? bounds.width;
  const height = explicitH ?? bounds.height;
  return { width, height, viewport: { x: bounds.x, y: bounds.y, width, height } };
}

/**
 * Render a single canvas (page) from Figma nodes. Width/height are derived
 * from the extent of the canvas children unless overridden. The viewport
 * carries the source coordinates; child transforms remain exactly as they
 * appear in the Kiwi document.
 */
export async function renderCanvas(
  canvasNode: FigNode,
  options: FigCanvasRenderOptions,
): Promise<FigSvgRenderResult> {
  const children = options.childrenOf(canvasNode);

  const explicitW = options.width;
  const explicitH = options.height;

  const canvasSize = resolveCanvasSize(children, explicitW, explicitH);
  const { width, height, viewport } = canvasSize;

  return renderFigToSvg(children, {
    ...options,
    width,
    height,
    viewport,
  });
}
