/**
 * @file Compression detection
 */

import { ZSTD_MAGIC, type CompressionType } from "./types";

/** Return true when the payload starts with the Zstandard magic bytes. */
export function isZstdCompressed(data: Uint8Array): boolean {
  return data.length >= 4 &&
    data[0] === ZSTD_MAGIC[0] &&
    data[1] === ZSTD_MAGIC[1] &&
    data[2] === ZSTD_MAGIC[2] &&
    data[3] === ZSTD_MAGIC[3];
}

/**
 * Detect compression type from data magic bytes.
 *
 * @param data - Compressed data
 * @returns Detected compression type
 */
export function detectCompression(data: Uint8Array): CompressionType {
  if (data.length < 4) {
    return "none";
  }

  if (isZstdCompressed(data)) {
    return "zstd";
  }

  throw new Error("Compression type cannot be detected; pass the compression type explicitly");
}
