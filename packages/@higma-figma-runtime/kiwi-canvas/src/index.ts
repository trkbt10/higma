/**
 * @file Product-free fig-family Kiwi canvas decoding.
 */

import { decompressDeflateRaw, decompressZstd, isZstdCompressed } from "@higma-codecs/compression";
import { decodeFigMessage, decodeFigSchema, splitFigChunks } from "@higma-codecs/kiwi/decoder";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import {
  getFigCanvasPayload,
  isFigCanvas,
  parseFigCanvasHeader,
  type FigCanvasHeader,
} from "@higma-figma-containers/canvas";
import {
  extractFigPackageContents,
  isZipPackage,
  type FigPackageImage,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";

export type FigmaKiwiCanvas = {
  readonly header: FigCanvasHeader;
  readonly schema: KiwiSchema;
  readonly message: Record<string, unknown>;
  readonly nodeChanges: readonly unknown[];
  readonly blobs: readonly unknown[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly metadata: FigPackageMetadata | null;
  readonly thumbnail: Uint8Array | null;
};

function decompressFigChunk(data: Uint8Array): Uint8Array {
  if (isZstdCompressed(data)) {
    return decompressZstd(data);
  }
  return decompressDeflateRaw(data);
}

function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/** Decode raw fig-family canvas bytes after ZIP extraction, if any. */
export function decodeRawFigmaKiwiCanvas(
  data: Uint8Array,
  images: ReadonlyMap<string, FigPackageImage> = new Map(),
  metadata: FigPackageMetadata | null = null,
  thumbnail: Uint8Array | null = null,
): FigmaKiwiCanvas {
  if (!isFigCanvas(data)) {
    throw new Error("Invalid fig-family canvas data: missing known magic header");
  }

  const header = parseFigCanvasHeader(data);
  const chunks = splitFigChunks(getFigCanvasPayload(data), header.payloadSize);
  const schema = decodeFigSchema(decompressFigChunk(chunks.schema));
  const message = decodeFigMessage(schema, decompressFigChunk(chunks.data), "Message");

  return {
    header,
    schema,
    message,
    nodeChanges: asArray(message.nodeChanges),
    blobs: asArray(message.blobs),
    images,
    metadata,
    thumbnail,
  };
}

/** Decode raw or ZIP-wrapped fig-family document bytes. */
export async function decodeFigmaKiwiCanvas(data: Uint8Array): Promise<FigmaKiwiCanvas> {
  if (!isZipPackage(data)) {
    return decodeRawFigmaKiwiCanvas(data);
  }

  const contents = await extractFigPackageContents(data);
  return decodeRawFigmaKiwiCanvas(
    contents.canvasData,
    contents.images,
    contents.metadata,
    contents.thumbnail,
  );
}
