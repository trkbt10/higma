/**
 * @file Fig export pipeline
 *
 * Exports a FigDesignDocument to .fig binary format.
 *
 * For documents loaded from existing .fig files (_loaded present),
 * uses the roundtrip strategy to preserve schema compatibility.
 * For fresh documents, builds from scratch using the builder API.
 */

import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import { documentToTree } from "../context/document-to-tree";
import { finalizeDerivedSymbolData } from "./finalize-derived-symbol-data";
import { FIGMA_KIWI_SCHEMA } from "@higma-figma-schema/profiles/schema";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageMetadata } from "@higma-figma-containers/package";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for exporting a .fig file.
 */
export type FigExportOptions = {
  /** Compression level for the output ZIP (1-9, default: 6) */
  readonly compressionLevel?: number;
  /** Re-encode the Kiwi schema instead of preserving original bytes (default: false) */
  readonly reencodeSchema?: boolean;
};

/**
 * Result of a .fig export operation.
 */
export type FigExportResult = {
  /** The .fig file as binary data */
  readonly data: Uint8Array;
  /** Size in bytes */
  readonly size: number;
};

// =============================================================================
// Export
// =============================================================================

/**
 * Export a FigDesignDocument to .fig binary format.
 *
 * This is the primary export function. It automatically detects whether
 * the document was loaded from an existing file (roundtrip) or created
 * from scratch, and uses the appropriate strategy.
 */
export async function exportFig(
  doc: FigDesignDocument,
  options?: FigExportOptions,
): Promise<FigExportResult> {
  // Recompute `derivedSymbolData` on every INSTANCE before projecting
  // the document into Kiwi. This is a load-bearing finalisation:
  // resized INSTANCEs that lack `derivedSymbolData` either render
  // slowly or render wrong in Figma. We do it at export time rather
  // than per-action so that later resize/move/duplicate actions cannot
  // leave the document with stale derived data.
  const finalisedDoc = finalizeDerivedSymbolData(doc);
  if (finalisedDoc._loaded) {
    return exportRoundtrip(finalisedDoc, finalisedDoc._loaded, options);
  }
  return exportFresh(finalisedDoc, options);
}

// =============================================================================
// Roundtrip Export
// =============================================================================

/**
 * Export using the roundtrip strategy (preserving original schema).
 */
async function exportRoundtrip(
  doc: FigDesignDocument,
  loaded: LoadedFigFile,
  options?: FigExportOptions,
): Promise<FigExportResult> {
  // Convert document modifications back to nodeChanges
  const treeResult = documentToTree(doc);

  // Create a modified copy of the loaded file
  const modifiedLoaded: LoadedFigFile = {
    ...loaded,
    nodeChanges: treeResult.nodeChanges,
  };

  // Save using original schema for compatibility
  const data = await saveFigFile(modifiedLoaded, {
    reencodeSchema: options?.reencodeSchema,
  });

  return { data, size: data.length };
}

// =============================================================================
// Fresh Export
// =============================================================================

/**
 * Default `meta.json` payload for fresh exports. Figma's importer
 * (and our own fig-lint `fig.zip.meta` rule) require a `meta.json`
 * entry to be present in the ZIP. The values below were empirically
 * derived from real Figma exports — `client_meta.background_color`,
 * `thumbnail_size`, and `render_coordinates` are the load-bearing
 * fields the importer reads at file open.
 */
function defaultFreshMetadata(doc: FigDesignDocument): FigPackageMetadata {
  return {
    raw: {},
    rawKeys: [],
    clientMeta: {
      backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
      thumbnailSize: { width: 400, height: 300 },
      renderCoordinates: { x: 0, y: 0, width: 800, height: 600 },
    },
    fileName: doc.pages[0]?.name ?? "Generated",
    developerRelatedLinks: [],
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Minimal 1×1 grayscale PNG used as a placeholder thumbnail.
 *
 * Figma's importer requires `thumbnail.png` to be present in the ZIP;
 * fig-lint's `fig.zip.thumbnail` rule flags its absence as an error.
 * The bytes below are the same payload the legacy `fig-file` builder
 * emitted (see `fig-file/thumbnail.ts`).
 */
function defaultFreshThumbnail(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x02,
    0x00, 0x00, 0x00,
    0x90, 0x77, 0x53, 0xde,
    0x00, 0x00, 0x00, 0x0c,
    0x49, 0x44, 0x41, 0x54,
    0x08, 0xd7, 0x63, 0x78, 0xf6, 0xf6, 0x06, 0x00, 0x02, 0x3b, 0x01, 0x1e,
    0xd6, 0xcc, 0x05, 0x0e,
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}

/**
 * Export a fresh document (not loaded from existing file).
 *
 * Creates a minimal LoadedFigFile structure and delegates to saveFigFile.
 * This produces a valid .fig file that can be opened in Figma.
 */
async function exportFresh(
  doc: FigDesignDocument,
  _options?: FigExportOptions,
): Promise<FigExportResult> {
  // Build nodeChanges from scratch
  const treeResult = documentToTree(doc);

  // Synthesise a default `meta.json` payload when the document
  // doesn't carry one. Without this `saveFigFamilyFile` skips the
  // entry and the produced ZIP fails Figma import + our own
  // `fig.zip.meta` lint rule.
  const metadata = doc.metadata ?? defaultFreshMetadata(doc);

  // Create a LoadedFigFile for saving using the canonical Figma Kiwi
  // schema bundled with `@higma-figma-schema/profiles`. The schema is
  // the single source of truth for the wire format; an empty
  // `definitions` array (the previous `minimal` stub) made the encoder
  // fail at the first `findDefinitionByName("Message")` lookup, so
  // scratch documents could not actually be exported.
  const thumbnail = defaultFreshThumbnail();
  // Real Figma exports stamp the canvas header version as "e".
  // The default "0" trips fig-lint's `fig.canvas.version` warning.
  const minimalLoaded: LoadedFigFile = {
    schema: FIGMA_KIWI_SCHEMA as KiwiSchema,
    compressedSchema: new Uint8Array(0),
    version: "e",
    nodeChanges: treeResult.nodeChanges,
    blobs: treeResult.blobs,
    images: doc.images,
    metadata,
    thumbnail,
    messageHeader: {
      type: { value: 0, name: "FULL_DOCUMENT" },
      sessionID: 1,
      ackID: 0,
    },
  };

  const data = await saveFigFile(minimalLoaded, {
    reencodeSchema: true,
    metadata,
    thumbnail,
  });

  return { data, size: data.length };
}
