/**
 * @file SoT helper for the four shared resources every renderer / scene-graph
 * builder needs alongside a `FigPage`.
 *
 * Background
 * ----------
 * Renderers and scene-graph builders all require the same four pieces of
 * out-of-band state:
 *
 *   - `symbolMap` — INSTANCE / SYMBOL resolution
 *   - `styleRegistry` — per-path / per-text-run shared style resolution
 *   - `blobs` — geometry decoding (fillGeometry / strokeGeometry / derived text)
 *   - `images` — IMAGE paint decoding
 *
 * Both `FigDesignDocument` and `FigSymbolContext` already expose these — but
 * each consumer was destructuring the four fields by hand and forwarding them
 * one by one through React props, hook params, and renderer options. That
 * pattern produced four separate dependency arrays, four memoization
 * boundaries, and four opportunities for one consumer to forget a field
 * (which historically caused INSTANCE / shared-style regressions).
 *
 * Single source of truth
 * ----------------------
 * `FigDocumentResources` is the canonical bundle. Every renderer-facing API
 * accepts it, and every consumer obtains it via `figDocumentResources(...)`
 * — never by re-destructuring the document or context inline.
 *
 * The two helpers below stay in `@higma-document-io/fig/context` because that
 * package already owns the parser → context layer; resources are the
 * "downstream face" the IO context exposes to renderers, builders, and the
 * React editor.
 */

import type { FigDesignDocument, FigDesignNode, FigImage, FigStyleRegistry } from "@higma-document-models/fig/domain";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigSymbolContext } from "./symbol-context";

/**
 * The four shared maps every renderer / scene-graph builder needs.
 *
 * `symbolMap` is intentionally typed as `ReadonlyMap<string, FigDesignNode>`
 * — the renderer-facing shape. The raw-FigNode shape used by the SVG
 * pipeline (`FigSymbolContext.symbolMap`) is a separate slot below.
 */
export type FigDocumentResources = {
  readonly symbolMap: ReadonlyMap<string, FigDesignNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly blobs: FigDesignDocument["blobs"];
  readonly images: ReadonlyMap<string, FigImage>;
};

/**
 * Extract the renderer-facing resource bundle from a `FigDesignDocument`.
 *
 * `FigDesignDocument.components` is the SoT for "every SYMBOL / COMPONENT in
 * the document keyed by string id" — the same shape the scene-graph builder
 * and React renderer expect for `symbolMap`. We expose the alias here so
 * call sites read like `figDocumentResources(document)` rather than
 * destructuring four fields and renaming `components` to `symbolMap`
 * everywhere.
 */
export function figDocumentResources(document: FigDesignDocument): FigDocumentResources {
  return {
    symbolMap: document.components,
    styleRegistry: document.styleRegistry,
    blobs: document.blobs,
    images: document.images,
  };
}

/**
 * The same bundle, but for callers that hold a raw `FigSymbolContext`
 * (typically the SVG renderer's external entry points: `renderFigToSvg`,
 * refine-fig's worker, fig-to-web's emit pipeline). The SVG pipeline reads
 * `symbolMap` as `ReadonlyMap<string, FigNode>` — *not* `FigDesignNode` —
 * because INSTANCE resolution operates on the raw, pre-conversion tree.
 *
 * Production callers obtain this via `figRawResources(ctx)` — never by
 * re-walking `ctx.tree.roots` or by destructuring the eight context
 * fields by hand.
 */
export type FigRawResources = {
  readonly symbolMap: ReadonlyMap<string, FigNode>;
  readonly styleRegistry: FigStyleRegistry;
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigImage>;
};

/**
 * Extract the raw-renderer resource bundle from a `FigSymbolContext`.
 *
 * Mirror of `figDocumentResources`, but for the raw-FigNode pipeline
 * (`renderFigToSvg`, refine-fig visual workers). Both helpers exist
 * because the document-level pipeline (`FigDesignNode`) and the file-level
 * pipeline (`FigNode`) carry the same four logical maps but one is
 * pre-converted and one is not — re-mapping at every consumer would
 * silently drift on edge cases.
 */
export function figRawResources(ctx: FigSymbolContext): FigRawResources {
  return {
    symbolMap: ctx.symbolMap,
    styleRegistry: ctx.styleRegistry,
    blobs: ctx.blobs,
    images: ctx.images,
  };
}
