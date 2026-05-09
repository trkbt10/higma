/**
 * @file Product-free roundtrip IO for fig-family Kiwi canvases.
 */

import { compressDeflateRaw, compressZstd, decompressFigChunk } from "@higma-codecs/compression";
import { decodeFigMessage, decodeFigSchema, splitFigChunks } from "@higma-codecs/kiwi/decoder";
import { encodeFigSchema } from "@higma-codecs/kiwi/fig-schema-encoder";
import { StreamingFigEncoder } from "@higma-codecs/kiwi/stream";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import { buildFigCanvasHeader, getFigCanvasPayload, parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import {
  buildFigPackageMetadataJson,
  createFigPackage,
  extractFigPackageContents,
  isZipPackage,
  type FigPackageImage,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";
import type { FigCanvasMagic } from "@higma-figma-schema/profiles";

import { denormaliseFigFamilyNodeForEncode, normaliseFigFamilyNodeChanges } from "./node-normalization";

export type FigFamilyImage = FigPackageImage;
export type FigFamilyMetadata = FigPackageMetadata;

export type LoadedFigFamilyFile<NodeChange = Record<string, unknown>, BlobValue = unknown> = {
  readonly schema: KiwiSchema;
  readonly compressedSchema: Uint8Array;
  readonly version: string;
  readonly canvasMagic: FigCanvasMagic;
  readonly nodeChanges: readonly NodeChange[];
  readonly blobs: readonly BlobValue[];
  readonly images: ReadonlyMap<string, FigFamilyImage>;
  readonly metadata: FigFamilyMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly messageHeader: Record<string, unknown>;
};

export type SaveFigFamilyOptions = {
  readonly metadata?: Partial<FigFamilyMetadata>;
  readonly thumbnail?: Uint8Array;
  readonly images?: ReadonlyMap<string, FigFamilyImage>;
  readonly reencodeSchema?: boolean;
  readonly canvasMagic: FigCanvasMagic;
};

type ExtractedFigFamilyData = {
  readonly data: Uint8Array;
  readonly metadata: FigFamilyMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly images: Map<string, FigFamilyImage>;
};

function resolveSchemaBytes<NodeChange, BlobValue>(
  loaded: LoadedFigFamilyFile<NodeChange, BlobValue>,
  reencode: boolean,
): Uint8Array {
  if (reencode) {
    return compressDeflateRaw(encodeFigSchema(loaded.schema));
  }
  return loaded.compressedSchema;
}

async function extractZipContents(data: Uint8Array): Promise<ExtractedFigFamilyData> {
  const contents = await extractFigPackageContents(data);
  return {
    data: contents.canvasData,
    metadata: contents.metadata,
    thumbnail: contents.thumbnail,
    images: new Map(contents.images),
  };
}

async function extractFigData(data: Uint8Array): Promise<ExtractedFigFamilyData> {
  if (isZipPackage(data)) {
    return extractZipContents(data);
  }
  return {
    data,
    metadata: null,
    thumbnail: null,
    images: new Map<string, FigFamilyImage>(),
  };
}

function readRequiredArray(value: unknown, fieldName: string): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`Expected fig-family message ${fieldName} to be an array`);
}

function readOptionalArray(value: unknown, fieldName: string): readonly unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`Expected fig-family message ${fieldName} to be an array when present`);
}

function createMessageHeader(message: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(message).filter(([key]) => key !== "nodeChanges"));
}

/** Load raw or ZIP-wrapped fig-family bytes while preserving schema/package state for save. */
export async function loadFigFamilyFile<NodeChange = Record<string, unknown>, BlobValue = unknown>(
  data: Uint8Array,
): Promise<LoadedFigFamilyFile<NodeChange, BlobValue>> {
  const extracted = await extractFigData(data);
  const header = parseFigCanvasHeader(extracted.data);
  const payload = getFigCanvasPayload(extracted.data);
  const chunks = splitFigChunks(payload, header.payloadSize);
  const schemaData = decompressFigChunk(chunks.schema);
  const messageData = decompressFigChunk(chunks.data);
  const schema = decodeFigSchema(schemaData);
  const message = decodeFigMessage(schema, messageData, "Message");

  return {
    schema,
    compressedSchema: chunks.schema,
    version: header.version,
    canvasMagic: header.magic,
    nodeChanges: normaliseFigFamilyNodeChanges<NodeChange>(readRequiredArray(message.nodeChanges, "nodeChanges")),
    blobs: readOptionalArray(message.blobs, "blobs") as readonly BlobValue[],
    images: extracted.images,
    metadata: extracted.metadata,
    thumbnail: extracted.thumbnail,
    messageHeader: createMessageHeader(message),
  };
}

function createHeaderFields<NodeChange, BlobValue>(
  loaded: LoadedFigFamilyFile<NodeChange, BlobValue>,
): Record<string, unknown> {
  const headerFields: Record<string, unknown> = {
    type: loaded.messageHeader.type as { value: number } | undefined,
    sessionID: loaded.messageHeader.sessionID,
    ackID: loaded.messageHeader.ackID,
  };

  if (loaded.blobs.length > 0) {
    headerFields.blobs = loaded.blobs;
  }

  return headerFields;
}

function writeMetadata(zip: ReturnType<typeof createFigPackage>, metadata: Partial<FigFamilyMetadata>): void {
  if (metadata.raw || metadata.clientMeta || metadata.fileName || metadata.exportedAt) {
    zip.writeText("meta.json", JSON.stringify(buildFigPackageMetadataJson(metadata)));
  }
}

function writeImages(
  zip: ReturnType<typeof createFigPackage>,
  loadedImages: ReadonlyMap<string, FigFamilyImage>,
  optionImages: ReadonlyMap<string, FigFamilyImage> | undefined,
): void {
  const allImages = new Map(loadedImages);
  if (optionImages) {
    for (const [ref, image] of optionImages) {
      allImages.set(ref, image);
    }
  }
  for (const [ref, image] of allImages) {
    zip.writeBinary(`images/${ref}`, image.data);
  }
}

/** Save a loaded fig-family file back to ZIP bytes using the original schema by default. */
export async function saveFigFamilyFile<NodeChange, BlobValue>(
  loaded: LoadedFigFamilyFile<NodeChange, BlobValue>,
  options: SaveFigFamilyOptions,
): Promise<Uint8Array> {
  const encoder = new StreamingFigEncoder({ schema: loaded.schema });
  encoder.writeHeader(createHeaderFields(loaded));

  for (const node of loaded.nodeChanges) {
    encoder.writeNodeChange(denormaliseFigFamilyNodeForEncode(node));
  }

  const messageData = encoder.finalize();
  const compressedMessage = await compressZstd(messageData, 3);
  const dataChunk = new Uint8Array(4 + compressedMessage.length);
  const dataView = new DataView(dataChunk.buffer);
  dataView.setUint32(0, compressedMessage.length, true);
  dataChunk.set(compressedMessage, 4);

  const schemaBytes = resolveSchemaBytes(loaded, options.reencodeSchema ?? false);
  const header = buildFigCanvasHeader(schemaBytes.length, loaded.version, options.canvasMagic);
  const canvasData = new Uint8Array(header.length + schemaBytes.length + dataChunk.length);
  canvasData.set(header, 0);
  canvasData.set(schemaBytes, header.length);
  canvasData.set(dataChunk, header.length + schemaBytes.length);

  const zip = createFigPackage();
  zip.writeBinary("canvas.fig", canvasData);
  writeMetadata(zip, { ...loaded.metadata, ...options.metadata });

  const thumbnailData = options.thumbnail ?? loaded.thumbnail;
  if (thumbnailData) {
    zip.writeBinary("thumbnail.png", thumbnailData);
  }

  writeImages(zip, loaded.images, options.images);

  const buffer = await zip.toArrayBuffer({ compressionLevel: 6 });
  return new Uint8Array(buffer);
}

export {
  denormaliseFigFamilyNodeForEncode,
  normaliseFigFamilyNodeChanges,
  type FigKiwiEnumValue,
} from "./node-normalization";
