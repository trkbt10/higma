/**
 * @file Roundtrip-capable .fig file editor
 *
 * Loads an existing .fig file, allows modification, and saves back
 * using the original schema for compatibility.
 *
 * This is primarily for validation and testing, not for building new files.
 */

import { compressZstd, compressDeflateRaw } from "@higma-codecs/compression";
import { decompressDeflateRaw, decompressZstd, isZstdCompressed } from "@higma-codecs/compression";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import { StreamingFigEncoder } from "@higma-codecs/kiwi/stream";
import { splitFigChunks, decodeFigSchema, decodeFigMessage } from "@higma-codecs/kiwi/decoder";
import type { FigNode } from "../types";
import type { FigBlob as ParserFigBlob, FigImage as ParserFigImage } from "../parser";
import {
  normaliseNodeChanges,
  denormaliseNodeForEncode,
} from "../parser";
import {
  buildFigCanvasHeader,
  getFigCanvasPayload,
  parseFigCanvasHeader,
} from "@higma-figma-containers/canvas";
import {
  buildFigPackageMetadataJson,
  createFigPackage,
  extractFigPackageContents,
  isZipPackage,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";
import { encodeFigSchema } from "./schema-encoder";

// =============================================================================
// Types
// =============================================================================

/** Metadata from the .fig file */
export type FigMetadata = FigPackageMetadata;

// FigImage is the SoT type from the parser. Re-export the same identity so
// callers that consume the roundtrip loader's `images` field and callers
// that consume the parser's `images` field hand around the same type —
// that erases the need for `as FigImage` casts at integration points.
export type FigImage = ParserFigImage;

/** Loaded .fig file data */
export type LoadedFigFile = {
  /** Original schema (for roundtrip) */
  readonly schema: KiwiSchema;
  /** Compressed schema bytes (for exact roundtrip) */
  readonly compressedSchema: Uint8Array;
  /** Header version character */
  readonly version: string;
  /** Node changes (raw Kiwi format) */
  readonly nodeChanges: FigNode[];
  /** Blobs */
  readonly blobs: readonly ParserFigBlob[];
  /** Images from ZIP */
  readonly images: ReadonlyMap<string, FigImage>;
  /** Metadata from meta.json */
  readonly metadata: FigMetadata | null;
  /** Thumbnail data */
  readonly thumbnail: Uint8Array | null;
  /** Message header fields (type, sessionID, etc.) */
  readonly messageHeader: Record<string, unknown>;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve schema bytes for roundtrip: re-encode or use original
 */
function resolveSchemaBytes(loaded: LoadedFigFile, reencode: boolean): Uint8Array {
  if (reencode) {
    const encodedSchema = encodeFigSchema(loaded.schema);
    return compressDeflateRaw(encodedSchema);
  }
  return loaded.compressedSchema;
}

function decompressFigChunk(data: Uint8Array): Uint8Array {
  return isZstdCompressed(data) ? decompressZstd(data) : decompressDeflateRaw(data);
}

type ExtractedZipData = {
  readonly data: Uint8Array;
  readonly metadata: FigMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly images: Map<string, FigImage>;
};

async function extractZipContents(data: Uint8Array): Promise<ExtractedZipData> {
  const contents = await extractFigPackageContents(data);
  return {
    data: contents.canvasData,
    metadata: contents.metadata,
    thumbnail: contents.thumbnail,
    images: new Map(contents.images),
  };
}

// =============================================================================
// Load Function
// =============================================================================

async function extractFigData(data: Uint8Array): Promise<ExtractedZipData> {
  if (isZipPackage(data)) {
    return extractZipContents(data);
  }
  return {
    data,
    metadata: null,
    thumbnail: null,
    images: new Map<string, FigImage>(),
  };
}

/**
 * Load a .fig file for roundtrip editing.
 * Preserves the original schema and metadata for compatibility.
 */
export async function loadFigFile(data: Uint8Array): Promise<LoadedFigFile> {
  const extracted = await extractFigData(data);

  // Parse header
  const header = parseFigCanvasHeader(extracted.data);
  const payload = getFigCanvasPayload(extracted.data);

  // Split chunks and keep compressed schema for exact roundtrip
  const chunks = splitFigChunks(payload, header.payloadSize);
  const compressedSchema = chunks.schema;

  // Decompress and decode
  const schemaData = decompressFigChunk(compressedSchema);
  const messageData = decompressFigChunk(chunks.data);
  const schema = decodeFigSchema(schemaData);
  const message = decodeFigMessage(schema, messageData, "Message");

  // Extract node changes — same SSoT kiwi→domain normalisation as
  // parser/fig-file.ts. After this, enum-shaped Kiwi fields (type,
  // blendMode, strokeCap, strokeJoin, strokeAlign, scaleMode) are the
  // domain string form.
  const rawNodes = Array.isArray(message.nodeChanges) ? message.nodeChanges : [];
  const nodeChanges = [...normaliseNodeChanges(rawNodes)];

  // Extract blobs
  const blobs = (message.blobs ?? []) as readonly ParserFigBlob[];

  // Extract message header (non-node fields, non-blob fields)
  const messageHeader: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (key !== "nodeChanges") {
      messageHeader[key] = value;
    }
  }

  return {
    schema,
    compressedSchema,
    version: header.version,
    nodeChanges,
    blobs,
    images: extracted.images,
    metadata: extracted.metadata,
    thumbnail: extracted.thumbnail,
    messageHeader,
  };
}

// =============================================================================
// Save Function
// =============================================================================

/** Options for saving */
export type SaveFigOptions = {
  /** Update metadata (merged with existing) */
  readonly metadata?: Partial<FigMetadata>;
  /** New thumbnail data */
  readonly thumbnail?: Uint8Array;
  /** Additional images to include */
  readonly images?: ReadonlyMap<string, FigImage>;
  /**
   * If true, re-encode the schema instead of using the original compressed bytes.
   * Use this for verification/testing to ensure full roundtrip works.
   * Default: false (uses original schema for Figma compatibility)
   */
  readonly reencodeSchema?: boolean;
};

/**
 * Save a loaded .fig file back to bytes.
 * Uses the original schema for compatibility.
 */
export async function saveFigFile(loaded: LoadedFigFile, options?: SaveFigOptions): Promise<Uint8Array> {
  // Re-encode message using streaming encoder with original schema
  const encoder = new StreamingFigEncoder({ schema: loaded.schema });

  // Write header fields including blobs
  const headerFields: Record<string, unknown> = {
    type: loaded.messageHeader.type as { value: number } | undefined,
    sessionID: (loaded.messageHeader.sessionID as number) ?? 1,
    ackID: (loaded.messageHeader.ackID as number) ?? 0,
  };

  // Include blobs if present (required for geometry rendering)
  if (loaded.blobs.length > 0) {
    headerFields.blobs = loaded.blobs;
  }

  encoder.writeHeader(headerFields);

  // Write node changes — denormalise domain-string enums back to
  // `{ value, name }` shape for the Kiwi encoder. This is the inverse
  // of the parser's normalisation pass.
  for (const node of loaded.nodeChanges) {
    encoder.writeNodeChange(denormaliseNodeForEncode(node));
  }

  const messageData = encoder.finalize();
  // Use zstd compression for message data (Figma's expected format)
  const compressedMessage = await compressZstd(messageData, 3);

  // Build data chunk with 4-byte LE size prefix
  const dataChunk = new Uint8Array(4 + compressedMessage.length);
  const dataView = new DataView(dataChunk.buffer);
  dataView.setUint32(0, compressedMessage.length, true);
  dataChunk.set(compressedMessage, 4);

  // Determine which schema bytes to use
  const schemaBytes = resolveSchemaBytes(loaded, options?.reencodeSchema ?? false);

  // Build canvas.fig
  const header = buildFigCanvasHeader(schemaBytes.length, loaded.version);
  const totalSize = header.length + schemaBytes.length + dataChunk.length;
  const canvasData = new Uint8Array(totalSize);
  canvasData.set(header, 0);
  canvasData.set(schemaBytes, header.length);
  canvasData.set(dataChunk, header.length + schemaBytes.length);

  // Create ZIP package
  const zip = createFigPackage();
  zip.writeBinary("canvas.fig", canvasData);

  // Add metadata
  const mergedMetadata = { ...loaded.metadata, ...options?.metadata };
  if (mergedMetadata.fileName || mergedMetadata.exportedAt) {
    zip.writeText("meta.json", JSON.stringify(buildFigPackageMetadataJson(mergedMetadata)));
  }

  // Add thumbnail
  const thumbnailData = options?.thumbnail ?? loaded.thumbnail;
  if (thumbnailData) {
    zip.writeBinary("thumbnail.png", thumbnailData);
  }

  // Add images
  const allImages = new Map(loaded.images);
  if (options?.images) {
    for (const [ref, img] of options.images) {
      allImages.set(ref, img);
    }
  }
  for (const [ref, img] of allImages) {
    zip.writeBinary(`images/${ref}`, img.data);
  }

  // Generate ZIP
  const buffer = await zip.toArrayBuffer({ compressionLevel: 6 });
  return new Uint8Array(buffer);
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Clone a loaded .fig file (deep copy of mutable parts).
 */
export function cloneFigFile(loaded: LoadedFigFile): LoadedFigFile {
  return {
    ...loaded,
    nodeChanges: loaded.nodeChanges.map((n) => ({ ...n })),
  };
}

/**
 * Add a node change to a loaded file.
 */
export function addNodeChange(loaded: LoadedFigFile, node: FigNode): void {
  loaded.nodeChanges.push(node);
}

/**
 * Find a node by name.
 */
export function findNodeByName(loaded: LoadedFigFile, name: string): FigNode | undefined {
  return loaded.nodeChanges.find((n) => n.name === name);
}

/**
 * Find nodes by type.
 */
export function findNodesByType(loaded: LoadedFigFile, typeName: string): FigNode[] {
  return loaded.nodeChanges.filter((n) => n.type?.name === typeName);
}
