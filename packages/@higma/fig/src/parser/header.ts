/**
 * @file Fig file header parsing
 */

import type { FigFileMagic, FigHeader } from "../types";
import { FIG_HEADER_SIZE, FIG_MAGIC, FIG_MAGIC_VALUES } from "../types";
import { FigParseError } from "../errors";

/** Text decoder for ASCII */
const textDecoder = new TextDecoder("ascii");
/** Text encoder for ASCII */
const textEncoder = new TextEncoder();

function parseMagic(data: Uint8Array): string {
  return textDecoder.decode(data.slice(0, 8));
}

function isKnownFigMagic(magic: string): magic is FigFileMagic {
  return FIG_MAGIC_VALUES.includes(magic as FigFileMagic);
}

/**
 * Check if data is a valid .fig file.
 *
 * @param data - Data to check
 * @returns true if data has valid .fig header
 */
export function isFigFile(data: Uint8Array): boolean {
  if (data.length < FIG_HEADER_SIZE) {
    return false;
  }

  return isKnownFigMagic(parseMagic(data));
}

/**
 * Parse a .fig file header.
 *
 * @param data - Raw .fig file data (at least 16 bytes)
 * @returns Parsed header
 * @throws FigParseError if header is invalid
 */
export function parseFigHeader(data: Uint8Array): FigHeader {
  if (data.length < FIG_HEADER_SIZE) {
    throw new FigParseError(
      `File too small: expected at least ${FIG_HEADER_SIZE} bytes, got ${data.length}`
    );
  }

  // Check magic header (8 bytes)
  const magic = parseMagic(data);
  if (!isKnownFigMagic(magic)) {
    throw new FigParseError(`Invalid magic header: expected one of ${FIG_MAGIC_VALUES.join(", ")}, got "${magic}"`);
  }

  // Version character (1 byte at offset 8)
  const version = String.fromCharCode(data[8]);

  // Reserved bytes (3 bytes at offset 9-11)
  // Skip these

  // Payload size (4 bytes at offset 12-15, little-endian)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const payloadSize = view.getUint32(12, true);

  return {
    magic,
    version,
    payloadSize,
  };
}

/**
 * Get the payload data from a .fig file.
 *
 * @param data - Raw .fig file data
 * @returns Payload data (after header)
 */
export function getPayload(data: Uint8Array): Uint8Array {
  return data.slice(FIG_HEADER_SIZE);
}

/**
 * Build a .fig file header.
 *
 * @param payloadSize - Size of the payload in bytes
 * @param version - Version character
 * @returns Header bytes
 */
export function buildFigHeader(payloadSize: number, version: string = "0"): Uint8Array {
  const header = new Uint8Array(FIG_HEADER_SIZE);
  const view = new DataView(header.buffer);
  const magicBytes = textEncoder.encode(FIG_MAGIC);
  header.set(magicBytes, 0);
  header[8] = version.charCodeAt(0);
  view.setUint32(12, payloadSize, true);
  return header;
}

/**
 * Build a complete raw fig-kiwi file from header and payload.
 */
export function buildFigFile(payload: Uint8Array, version: string = "0"): Uint8Array {
  const header = buildFigHeader(payload.length, version);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header, 0);
  result.set(payload, header.length);
  return result;
}
