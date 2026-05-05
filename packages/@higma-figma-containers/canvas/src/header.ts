/**
 * @file Raw fig-family canvas header
 */

import { FIG_CANVAS_MAGICS, isFigCanvasMagic, type FigCanvasMagic } from "@higma-figma-schema/profiles";

export type FigCanvasHeader = {
  readonly magic: FigCanvasMagic;
  readonly version: string;
  readonly payloadSize: number;
};

export const FIG_CANVAS_HEADER_SIZE = 16;
export const DEFAULT_FIG_CANVAS_MAGIC: FigCanvasMagic = "fig-kiwi";

const textDecoder = new TextDecoder("ascii");
const textEncoder = new TextEncoder();

function parseMagic(data: Uint8Array): string {
  return textDecoder.decode(data.slice(0, 8));
}

/** Return true when bytes start with a known fig-family raw canvas header. */
export function isFigCanvas(data: Uint8Array): boolean {
  if (data.length < FIG_CANVAS_HEADER_SIZE) {
    return false;
  }
  return isFigCanvasMagic(parseMagic(data));
}

/** Parse the fixed-size raw fig-family canvas header. */
export function parseFigCanvasHeader(data: Uint8Array): FigCanvasHeader {
  if (data.length < FIG_CANVAS_HEADER_SIZE) {
    throw new Error(`File too small: expected at least ${FIG_CANVAS_HEADER_SIZE} bytes, got ${data.length}`);
  }

  const magic = parseMagic(data);
  if (!isFigCanvasMagic(magic)) {
    throw new Error(`Invalid magic header: expected one of ${FIG_CANVAS_MAGICS.join(", ")}, got "${magic}"`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    magic,
    version: String.fromCharCode(data[8]),
    payloadSize: view.getUint32(12, true),
  };
}

/** Return raw canvas payload bytes after the fixed-size header. */
export function getFigCanvasPayload(data: Uint8Array): Uint8Array {
  return data.slice(FIG_CANVAS_HEADER_SIZE);
}

/** Build a fixed-size raw fig-family canvas header. */
export function buildFigCanvasHeader(
  payloadSize: number,
  version: string = "0",
  magic: FigCanvasMagic = DEFAULT_FIG_CANVAS_MAGIC,
): Uint8Array {
  const header = new Uint8Array(FIG_CANVAS_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header.set(textEncoder.encode(magic), 0);
  header[8] = version.charCodeAt(0);
  view.setUint32(12, payloadSize, true);
  return header;
}

/** Build a complete raw fig-family canvas file from payload bytes. */
export function buildFigCanvasFile(
  payload: Uint8Array,
  version: string = "0",
  magic: FigCanvasMagic = DEFAULT_FIG_CANVAS_MAGIC,
): Uint8Array {
  const header = buildFigCanvasHeader(payload.length, version, magic);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header, 0);
  result.set(payload, header.length);
  return result;
}
