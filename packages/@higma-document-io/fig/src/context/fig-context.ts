/**
 * @file Fig design document creation from various sources
 *
 * Entry points for creating a FigDesignDocument from:
 * - A raw buffer (file bytes)
 * - A pre-loaded LoadedFigFile (roundtrip module)
 * - Scratch (empty document)
 */

import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigDesignDocument, FigPage } from "@higma-document-models/fig/domain";
import { buildNodeTree, DEFAULT_PAGE_BACKGROUND, EMPTY_FIG_STYLE_REGISTRY, toPageId } from "@higma-document-models/fig/domain";
import { asBlobArray, normaliseNodeChanges } from "../parser";
import { treeToDocument } from "./tree-to-document";
import { createFigSymbolContextFromLoaded } from "./symbol-context";

export type CreateFigDesignDocumentFromKiwiCanvasOptions = {
  readonly canvasVisibility: "user-visible" | "all";
};

// =============================================================================
// From Loaded File
// =============================================================================

/**
 * Create a FigDesignDocument from a LoadedFigFile.
 *
 * Use this when you already have a loaded file (e.g., from loadFigFile()).
 *
 * Internally goes through `createFigSymbolContextFromLoaded` so the raw
 * tree, nodeMap, and styleRegistry are derived once and shared with
 * `treeToDocument`. Callers that already hold a `FigSymbolContext`
 * should call `treeToDocument(ctx.tree, loaded, { styleRegistry: ctx.styleRegistry })`
 * directly instead of re-deriving here.
 */
export function createFigDesignDocumentFromLoaded(loaded: LoadedFigFile): FigDesignDocument {
  const ctx = createFigSymbolContextFromLoaded(loaded);
  return treeToDocument(ctx.tree, loaded, { styleRegistry: ctx.styleRegistry });
}

/**
 * Create a FigDesignDocument from an already decoded fig-family canvas.
 *
 * Product-specific formats such as site/deck/buzz decode through
 * @higma-figma-runtime/kiwi-canvas first. This adapter keeps their visual
 * rendering on the same FigDesignDocument -> scene graph -> renderer path
 * used by the fig editor, without requiring a .fig roundtrip package.
 */
export function createFigDesignDocumentFromKiwiCanvas(
  canvas: FigmaKiwiCanvas,
  options: CreateFigDesignDocumentFromKiwiCanvasOptions,
): FigDesignDocument {
  const nodeChanges = normaliseNodeChanges(canvas.nodeChanges);
  const tree = buildNodeTree(nodeChanges);
  return treeToDocument(tree, {
    blobs: asBlobArray(canvas.blobs),
    images: canvas.images,
    metadata: canvas.metadata,
    canvasVisibility: options.canvasVisibility,
  });
}

// =============================================================================
// From Buffer
// =============================================================================

/**
 * Create a FigDesignDocument from a raw .fig file buffer.
 *
 * This is the primary entry point for loading .fig files.
 * Internally loads the file via roundtrip (preserving schema for re-export)
 * and converts the node tree to the high-level document model.
 */
export async function createFigDesignDocument(buffer: Uint8Array): Promise<FigDesignDocument> {
  const loaded = await loadFigFile(buffer);
  return createFigDesignDocumentFromLoaded(loaded);
}

// =============================================================================
// Empty Document
// =============================================================================

/**
 * Create an empty FigDesignDocument with a single blank page.
 *
 * Use this when creating a new .fig file from scratch.
 */
export function createEmptyFigDesignDocument(pageName = "Page 1"): FigDesignDocument {
  const pageId = toPageId("0:1");
  const page: FigPage = {
    id: pageId,
    name: pageName,
    backgroundColor: DEFAULT_PAGE_BACKGROUND,
    children: [],
  };

  return {
    pages: [page],
    documentColorProfile: { value: 1, name: "SRGB" },
    components: new Map(),
    images: new Map(),
    blobs: [],
    metadata: null,
    styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
  };
}
