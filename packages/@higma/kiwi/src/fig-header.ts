/**
 * @file Minimal fig-kiwi header helpers for codec tests
 */

import { KiwiParseError } from "./errors";

const FIG_HEADER_SIZE = 16;
const FIG_MAGIC = "fig-kiwi";
const textDecoder = new TextDecoder("ascii");

export type FigKiwiHeader = {
  readonly magic: typeof FIG_MAGIC;
  readonly version: string;
  readonly payloadSize: number;
};

/**
 * Parse a fig-kiwi header.
 */
export function parseFigHeader(data: Uint8Array): FigKiwiHeader {
  if (data.length < FIG_HEADER_SIZE) {
    throw new KiwiParseError(`File too small: expected at least ${FIG_HEADER_SIZE} bytes, got ${data.length}`);
  }

  const magic = textDecoder.decode(data.slice(0, 8));
  if (magic !== FIG_MAGIC) {
    throw new KiwiParseError(`Invalid magic header: expected "${FIG_MAGIC}", got "${magic}"`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    magic: FIG_MAGIC,
    version: String.fromCharCode(data[8]),
    payloadSize: view.getUint32(12, true),
  };
}

/**
 * Return the fig-kiwi payload after the fixed-size header.
 */
export function getPayload(data: Uint8Array): Uint8Array {
  return data.slice(FIG_HEADER_SIZE);
}
