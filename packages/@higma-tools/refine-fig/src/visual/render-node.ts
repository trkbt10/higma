/**
 * @file Render any FigNode subtree to SVG / PNG with a content-keyed
 * memoization layer.
 *
 * The renderer is the same `renderFigToSvg` the verify-fidelity
 * pipeline uses; we only change the entry shape so a caller can
 * render *any* node in the document, not just top-level frames. The
 * rasterised PNG width is clamped (default 256px) so a perceptual
 * hash can be computed cheaply over thousands of subtrees without
 * blowing memory.
 *
 * Memoization key: a stable hash over the node's GUID *plus* the
 * fields that materially affect the visual output (name does not
 * count). When the same key is hit twice, we return the cached PNG
 * instead of re-rendering. The cache is in-process and intentionally
 * never persisted: mutations during apply() invalidate everything,
 * so a simple reference-equality cache is enough.
 */
import { createHash } from "node:crypto";
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import { createCachingFontLoader, figmaFontToQuery } from "@higma-document-renderers/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
import type { FontLoader } from "@higma-document-renderers/fig/font";
import { Resvg } from "@resvg/resvg-js";
import type { FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { guidToString, safeChildren } from "@higma-document-models/fig/domain";

export type NodeRenderContext = {
  readonly loaded: LoadedFigFile;
  /** Document-wide map from `sessionID:localID` to FigNode (used for INSTANCE resolution). */
  readonly symbolMap: ReadonlyMap<string, FigNode>;
};

export type RenderedNode = {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
  readonly png: Uint8Array;
};

export type RenderOptions = {
  /** Maximum raster width. Subtrees wider than this are scaled. Default 256. */
  readonly maxRasterWidth?: number;
};

type Cache = Map<string, RenderedNode>;

export type NodeRenderer = {
  readonly render: (node: FigNode, options?: RenderOptions) => Promise<RenderedNode | undefined>;
  readonly stats: () => { readonly hits: number; readonly misses: number };
};

/**
 * Build a node renderer bound to a particular loaded file. The font
 * loader and renderer are shared across every render so the OpenType
 * cache hits across calls.
 */
export function createNodeRenderer(ctx: NodeRenderContext): NodeRenderer {
  const cache: Cache = new Map();
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  const counter = { hits: 0, misses: 0 };

  async function render(node: FigNode, options: RenderOptions = {}): Promise<RenderedNode | undefined> {
    if (!node.size) {
      return undefined;
    }
    // Resvg panics in native code when handed a zero / non-finite
    // dimension (`geom::Size::from_wh(...).unwrap()` on a None). The
    // panic is unrecoverable from JS, so refuse early.
    if (!Number.isFinite(node.size.x) || !Number.isFinite(node.size.y) || node.size.x <= 0 || node.size.y <= 0) {
      return undefined;
    }
    const max = options.maxRasterWidth ?? 256;
    const key = cacheKey(node, max);
    const cached = cache.get(key);
    if (cached) {
      counter.hits = counter.hits + 1;
      return cached;
    }
    counter.misses = counter.misses + 1;
    // Pre-flight: refuse to render subtrees that contain TEXT whose
    // font cannot be resolved by the configured loader. The renderer
    // itself throws on missing fonts, but resvg-js can panic at a
    // deeper layer when partially-resolvable fonts are encountered;
    // a panic from native code crashes the host process. Pre-checking
    // keeps the workbench loop alive so the agent gets every reviewable
    // candidate.
    const missing = await unresolvableFonts(node, fontLoader);
    if (missing) {
      throw new Error(`createNodeRenderer: subtree references font "${missing}" which the host font loader cannot resolve`);
    }
    const result = await renderFigToSvg([node], {
      width: node.size.x,
      height: node.size.y,
      blobs: ctx.loaded.blobs ?? [],
      images: ctx.loaded.images ?? new Map(),
      normalizeRootTransform: true,
      symbolMap: ctx.symbolMap,
      fontLoader,
    });
    const svg = String(result.svg);
    const fitWidth = Math.max(1, Math.min(max, Math.round(node.size.x)));
    const png = svgToPng(svg, fitWidth);
    const rendered: RenderedNode = {
      key,
      width: fitWidth,
      height: Math.max(1, Math.round((node.size.y / node.size.x) * fitWidth)),
      svg,
      png,
    };
    cache.set(key, rendered);
    return rendered;
  }

  return {
    render,
    stats: () => ({ hits: counter.hits, misses: counter.misses }),
  };
}

/**
 * Walk the subtree and ask the font loader about every distinct
 * `(family, weight, style)` referenced by a TEXT node. Returns the
 * first family that the loader cannot satisfy, or `undefined` when
 * every TEXT-required face resolves.
 *
 * Pre-flighting before resvg avoids a class of native-side panics
 * triggered by partially-resolvable fonts: the renderer's own
 * `loadFont` call can succeed for one weight while resvg later
 * panics on a different weight referenced inside the same subtree.
 * Asking the loader first short-circuits that whole code path.
 */
async function unresolvableFonts(node: FigNode, loader: FontLoader): Promise<string | undefined> {
  const queries = new Map<string, ReturnType<typeof figmaFontToQuery>>();
  collectFontQueries(node, queries);
  for (const query of queries.values()) {
    if (!query.family) {
      continue;
    }
    const loaded = await loader.loadFont(query);
    if (!loaded) {
      return query.family;
    }
  }
  return undefined;
}

function collectFontQueries(
  node: FigNode,
  out: Map<string, ReturnType<typeof figmaFontToQuery>>,
): void {
  if (node.type?.name === "TEXT" && node.fontName) {
    const q = figmaFontToQuery(node.fontName);
    const key = `${q.family}|${q.weight}|${q.style}`;
    if (!out.has(key)) {
      out.set(key, q);
    }
  }
  for (const child of safeChildren(node)) {
    collectFontQueries(child, out);
  }
}

function svgToPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

function cacheKey(node: FigNode, maxRasterWidth: number): string {
  // Include guid + size + a structural digest so swap-out of a single
  // descendant invalidates the cache.
  const guid = guidToString(node.guid);
  const digest = createHash("sha1");
  digest.update(guid);
  digest.update("|");
  digest.update(String(maxRasterWidth));
  digest.update("|");
  appendStructuralDigest(node, digest, 0);
  return `${guid}@${maxRasterWidth}:${digest.digest("hex").slice(0, 16)}`;
}

function appendStructuralDigest(
  node: FigNode,
  digest: { update: (s: string) => unknown },
  depth: number,
): void {
  digest.update(node.type?.name ?? "?");
  digest.update("/");
  if (node.size) {
    digest.update(`${Math.round(node.size.x)}x${Math.round(node.size.y)}`);
  }
  digest.update("/");
  if (node.fillPaints) {
    digest.update(`fp:${node.fillPaints.length}`);
  }
  if (depth > 6) {
    return;
  }
  const kids = safeChildren(node);
  digest.update(`<${kids.length}>`);
  for (const child of kids) {
    appendStructuralDigest(child, digest, depth + 1);
  }
}
