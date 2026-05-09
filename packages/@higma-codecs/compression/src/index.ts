/**
 * @file Compression module exports
 *
 * Unified compression/decompression utilities for fig files.
 */

export { type CompressionType, ZSTD_MAGIC } from "./types";
export { detectCompression, isZstdCompressed } from "./detect";
export {
  compressDeflate,
  decompressDeflate,
  compressDeflateRaw,
  decompressDeflateRaw,
  type DeflateLevel,
} from "./deflate";
export {
  decompressZstd,
  compressZstd,
  createZstdCompressor,
  type ZstdCompressor,
} from "./zstd";

import type { CompressionType } from "./types";
import { compressDeflateRaw, decompressDeflateRaw, type DeflateLevel } from "./deflate";
import { compressZstd, decompressZstd } from "./zstd";
import { detectCompression, isZstdCompressed } from "./detect";

/**
 * Decompress data based on detected or specified compression type.
 *
 * @param data - Compressed data
 * @param type - Optional compression type (auto-detected if not specified)
 * @returns Decompressed data
 */
export function decompress(data: Uint8Array, type?: CompressionType): Uint8Array {
  const compressionType = type ?? detectCompression(data);
  switch (compressionType) {
    case "zstd":
      return decompressZstd(data);
    case "deflate":
      return decompressDeflateRaw(data);
    case "none":
      return data;
  }
}

/**
 * Compress data using the specified compression type.
 *
 * @param data - Data to compress
 * @param type - Compression type
 * @param level - Compression level
 * @returns Compressed data
 */
export async function compress(
  data: Uint8Array,
  type: CompressionType,
  level: number = 6
): Promise<Uint8Array> {
  switch (type) {
    case "zstd":
      return compressZstd(data, level);
    case "deflate":
      return compressDeflateRaw(data, level as DeflateLevel);
    case "none":
      return data;
  }
}

/**
 * Decompress a fig-family payload chunk.
 *
 * The fig binary format stores either zstd-compressed bytes (detectable via
 * magic) or raw-deflate bytes (no header, no magic). When the chunk does not
 * start with the zstd magic, the format mandates raw deflate — there is no
 * other valid encoding. Centralised here so every fig-family runtime decodes
 * payload chunks the same way.
 */
export function decompressFigChunk(data: Uint8Array): Uint8Array {
  if (isZstdCompressed(data)) {
    return decompressZstd(data);
  }
  return decompressDeflateRaw(data);
}
