/**
 * @file PNG image container and sync read/write API
 *
 * Provides a pngjs-compatible API surface:
 * - createPngImage({ width, height }) — create an empty RGBA image
 * - readPng(buffer) — decode a PNG buffer (equivalent to PNG.sync.read)
 * - writePng(image) — encode to PNG buffer (equivalent to PNG.sync.write)
 */

import { pack, type PngChromaticity, type PngIccProfile } from "./pngjs";
import { parseSync, type ParseMetadataResult } from "./pngjs";

/**
 * Mutable RGBA image container.
 * Compatible with the pngjs `PNG` object shape (width, height, data).
 */
export type PngImage = {
  readonly width: number;
  readonly height: number;
  /** RGBA pixel data, 4 bytes per pixel, row-major order. */
  data: Uint8Array;
  readonly gamma?: number;
  readonly srgbIntent?: number;
  readonly chromaticity?: PngChromaticity;
  readonly iccProfile?: PngIccProfile;
};

export type PngImageMetadata = Omit<PngImage, "data">;

export type PngReadOptions =
  | { readonly content?: "data" }
  | { readonly content: "metadata" };

/**
 * Create an empty RGBA image filled with zeros.
 *
 * Equivalent to `new PNG({ width, height })` in pngjs.
 */
export function createPngImage(args: { width: number; height: number }): PngImage {
  return {
    width: args.width,
    height: args.height,
    data: new Uint8Array(args.width * args.height * 4),
  };
}

/**
 * Decode a PNG buffer into a PngImage.
 *
 * Equivalent to `PNG.sync.read(buffer)` in pngjs.
 */
export function readPng(buffer: Uint8Array): PngImage;
export function readPng(buffer: Uint8Array, options: { readonly content?: "data" }): PngImage;
export function readPng(buffer: Uint8Array, options: { readonly content: "metadata" }): PngImageMetadata;
export function readPng(buffer: Uint8Array, options?: PngReadOptions): PngImage | PngImageMetadata {
  if (options?.content === "metadata") {
    return pngMetadataFromParseResult(parseSync(buffer, "metadata"));
  }
  const result = parseSync(buffer, "data");
  return {
    width: result.width,
    height: result.height,
    data: result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data.buffer),
    gamma: result.gamma === 0 ? undefined : result.gamma,
    srgbIntent: result.srgbIntent,
    chromaticity: result.chromaticity,
    iccProfile: result.iccProfile,
  };
}

/**
 * Read only the chunk-level metadata (no inflate, no pixel decode).
 *
 * Equivalent to `readPng(buffer, { content: "metadata" })` but with a
 * narrow return type so callers don't need a discriminator. Used by
 * fast paths (e.g. resolving the source colour profile of an image
 * paint without paying the full PNG decode cost).
 */
export function readPngMetadata(buffer: Uint8Array): PngImageMetadata {
  return pngMetadataFromParseResult(parseSync(buffer, "metadata"));
}

function pngMetadataFromParseResult(result: ParseMetadataResult): PngImageMetadata {
  return {
    width: result.width,
    height: result.height,
    gamma: result.gamma === 0 ? undefined : result.gamma,
    srgbIntent: result.srgbIntent,
    chromaticity: result.chromaticity,
    iccProfile: result.iccProfile,
  };
}

/**
 * Encode a PngImage into a PNG buffer.
 *
 * Equivalent to `PNG.sync.write(png)` in pngjs.
 */
export function writePng(image: PngImage): Uint8Array {
  return pack({
    width: image.width,
    height: image.height,
    data: image.data,
    gamma: image.gamma,
    srgbIntent: image.srgbIntent,
    chromaticity: image.chromaticity,
    iccProfile: image.iccProfile,
  });
}
