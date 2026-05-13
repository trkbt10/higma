/**
 * @file Fig export pipeline
 *
 * Exports a FigDesignDocument to .fig binary format.
 *
 * For documents loaded from existing .fig files (_loaded present),
 * uses the roundtrip strategy to preserve schema compatibility.
 * For fresh documents, builds from scratch using the builder API.
 */

import { encodeRgbaToPng } from "@higma-codecs/png";
import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import { createNodeChangesMessageHeader } from "@higma-document-models/fig/domain";
import { documentToTree } from "../context/document-to-tree";
import { finalizeDerivedSymbolData } from "./finalize-derived-symbol-data";
import {
  patchMetadataForThumbnail,
  prepareExportThumbnail,
  type FigPreparedThumbnail,
  type FigThumbnailRenderer,
} from "./thumbnail-pipeline";
import { FIGMA_KIWI_SCHEMA } from "@higma-figma-schema/profiles/schema";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import {
  FIG_THUMBNAIL_MAX_DIMENSION,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";

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
  /**
   * Rasterises the document's "Set as thumbnail" target into PNG bytes.
   *
   * Required when `doc.thumbnailTarget` is set; ignored otherwise. The
   * exporter never invents a default rasteriser — AGENTS.md "No Magic"
   * forbids importing a Node-only renderer here, since the io package
   * must build for browser too. Callers wire their own (e.g. the editor
   * uses an OffscreenCanvas/WebGL pipeline; CLI tools wrap resvg-js).
   */
  readonly renderThumbnail?: FigThumbnailRenderer;
  /**
   * Override the maximum PNG width/height handed to `renderThumbnail`.
   * Defaults to `FIG_THUMBNAIL_MAX_DIMENSION` from
   * `@higma-figma-containers/package` (400 — sampled from every
   * community `.fig` in the wild).
   */
  readonly thumbnailMaxDimension?: number;
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
  // Run the thumbnail pipeline once — both export strategies consume
  // the same `FigPreparedThumbnail`. `prepareExportThumbnail` returns
  // `undefined` when `doc.thumbnailTarget` is unset; in that case both
  // strategies fall back to the placeholder/loaded thumbnail.
  const preparedThumbnail = await prepareExportThumbnail(
    finalisedDoc,
    options?.renderThumbnail,
    options?.thumbnailMaxDimension ?? FIG_THUMBNAIL_MAX_DIMENSION,
  );
  if (finalisedDoc._loaded) {
    return exportRoundtrip(finalisedDoc, finalisedDoc._loaded, options, preparedThumbnail);
  }
  return exportFresh(finalisedDoc, options, preparedThumbnail);
}

/**
 * Wrap `patchMetadataForThumbnail` with a null-passthrough so callers
 * can hand a possibly-undefined `preparedThumbnail` without sprinkling
 * conditional ternaries through the export flow.
 *
 * Overloaded so TypeScript knows the result is non-null whenever the
 * input was non-null.
 */
function patchMetadataIfRendered(
  base: FigPackageMetadata,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata;
function patchMetadataIfRendered(
  base: FigPackageMetadata | null,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata | null;
function patchMetadataIfRendered(
  base: FigPackageMetadata | null,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata | null {
  if (!rendered) {
    return base;
  }
  return patchMetadataForThumbnail(base, rendered);
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
  options: FigExportOptions | undefined,
  preparedThumbnail: FigPreparedThumbnail | undefined,
): Promise<FigExportResult> {
  // Convert document modifications back to nodeChanges
  const treeResult = documentToTree(doc);

  // When we re-rasterise the thumbnail, propagate the new bytes onto
  // the LoadedFigFile so a subsequent reload sees consistent state
  // (and so any caller that bypasses the explicit `thumbnail` save
  // option still gets the fresh PNG).
  const thumbnailBytes = preparedThumbnail?.png ?? loaded.thumbnail;
  const refreshedMetadata = patchMetadataIfRendered(loaded.metadata, preparedThumbnail);
  const modifiedLoaded: LoadedFigFile = {
    ...loaded,
    nodeChanges: treeResult.nodeChanges,
    thumbnail: thumbnailBytes ?? null,
    metadata: refreshedMetadata,
  };

  // Save using original schema for compatibility. We forward
  // `thumbnail` + `metadata` explicitly when we regenerated them —
  // `saveFigFile` writes those bytes verbatim into the ZIP.
  const data = await saveFigFile(modifiedLoaded, {
    reencodeSchema: options?.reencodeSchema,
    ...(preparedThumbnail ? { thumbnail: preparedThumbnail.png } : {}),
    ...(modifiedLoaded.metadata ? { metadata: modifiedLoaded.metadata } : {}),
  });

  return { data, size: data.length };
}

// =============================================================================
// Fresh Export
// =============================================================================

/**
 * Default `meta.json` payload for fresh exports. Figma's importer
 * (and our own fig-lint `fig.zip.meta` rule) require a `meta.json`
 * entry to be present in the ZIP.
 *
 * `thumbnail_size` and `render_coordinates` are intentionally derived
 * from `FIG_THUMBNAIL_MAX_DIMENSION` — Figma's importer reads them at
 * file open, and grounding both in the SoT keeps a single number on
 * the source-of-truth side instead of two divergent literals.
 */
function defaultFreshMetadata(doc: FigDesignDocument): FigPackageMetadata {
  // 4:3 aspect ratio is the placeholder shape Figma's own fresh
  // exports happen to use; matched here so an unedited round trip
  // produces the same proportions as a real export.
  const thumbW = FIG_THUMBNAIL_MAX_DIMENSION;
  const thumbH = Math.round((FIG_THUMBNAIL_MAX_DIMENSION * 3) / 4);
  return {
    raw: {},
    rawKeys: [],
    clientMeta: {
      backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
      thumbnailSize: { width: thumbW, height: thumbH },
      renderCoordinates: { x: 0, y: 0, width: thumbW * 2, height: thumbH * 2 },
    },
    fileName: doc.pages[0]?.name ?? "Generated",
    developerRelatedLinks: [],
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Minimal 1×1 transparent PNG used as a placeholder thumbnail.
 *
 * Figma's importer requires `thumbnail.png` to be present in the ZIP;
 * fig-lint's `fig.zip.thumbnail` rule flags its absence as an error.
 * Built through the codec SoT (`@higma-codecs/png`) rather than a
 * hand-baked byte literal so a codec schema bump (CRC layout, etc.)
 * propagates automatically.
 */
function defaultFreshThumbnail(): Uint8Array {
  const rgba = new Uint8ClampedArray([0x00, 0x00, 0x00, 0x00]);
  return encodeRgbaToPng(rgba, 1, 1);
}

/**
 * Export a fresh document (not loaded from existing file).
 *
 * Creates a minimal LoadedFigFile structure and delegates to saveFigFile.
 * This produces a valid .fig file that can be opened in Figma.
 */
async function exportFresh(
  doc: FigDesignDocument,
  _options: FigExportOptions | undefined,
  preparedThumbnail: FigPreparedThumbnail | undefined,
): Promise<FigExportResult> {
  // Build nodeChanges from scratch
  const treeResult = documentToTree(doc);

  // Synthesise a default `meta.json` payload when the document
  // doesn't carry one. Without this `saveFigFamilyFile` skips the
  // entry and the produced ZIP fails Figma import + our own
  // `fig.zip.meta` lint rule.
  const baseMetadata = doc.metadata ?? defaultFreshMetadata(doc);
  // When the user picked a frame as the cover, patch `client_meta`'s
  // `thumbnail_size` + `render_coordinates` so meta.json matches the
  // bytes we're about to write. Otherwise leave whatever was already
  // there alone (the fresh-export defaults are deliberately mock-ish
  // and not load-bearing for Figma's importer).
  const metadata = patchMetadataIfRendered(baseMetadata, preparedThumbnail);

  // Create a LoadedFigFile for saving using the canonical Figma Kiwi
  // schema bundled with `@higma-figma-schema/profiles`. The schema is
  // the single source of truth for the wire format; an empty
  // `definitions` array (the previous `minimal` stub) made the encoder
  // fail at the first `findDefinitionByName("Message")` lookup, so
  // scratch documents could not actually be exported.
  const thumbnail = preparedThumbnail?.png ?? defaultFreshThumbnail();
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
    // The `messageHeader` SoT lives in `@higma-document-models/fig/domain`.
    // `createNodeChangesMessageHeader` resolves the schema-canonical
    // (value, name) pair for `NODE_CHANGES` at module load and is the only
    // sanctioned path for synthesising a fresh-export header.
    messageHeader: createNodeChangesMessageHeader(),
  };

  const data = await saveFigFile(minimalLoaded, {
    reencodeSchema: true,
    metadata,
    thumbnail,
  });

  return { data, size: data.length };
}
