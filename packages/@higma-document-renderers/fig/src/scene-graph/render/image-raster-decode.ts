/** @file Raster image decoding (PNG via @higma-codecs/png, JPEG via jpeg-js). */

import { readPng, readPngMetadata, type PngImage, type PngImageMetadata } from "@higma-codecs/png";
import { decode as decodeJpeg } from "jpeg-js";
import {
  extractJpegIccProfile,
  recognizeImagePixelColorSpace,
  type IccProfile,
  type ImagePixelColorSpace,
} from "@higma-codecs/raster";

export type DecodedRasterImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly gamma?: number;
  readonly srgbIntent?: number;
  readonly chromaticity?: PngImage["chromaticity"];
  readonly iccProfile?: IccProfile;
};

function decodePngImage(data: Uint8Array): DecodedRasterImage {
  const image = readPng(data);
  return {
    width: image.width,
    height: image.height,
    data: image.data,
    gamma: image.gamma,
    srgbIntent: image.srgbIntent,
    chromaticity: image.chromaticity,
    iccProfile: image.iccProfile,
  };
}

function decodeJpegImage(data: Uint8Array): DecodedRasterImage {
  const image = decodeJpeg(data, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
  });
  return {
    width: image.width,
    height: image.height,
    data: image.data,
    iccProfile: extractJpegIccProfile(data),
  };
}

function isJpegMimeType(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/jpg";
}

/** Decodes supported image paint bytes into straight RGBA pixels for raster filtering. */
export function decodeRasterImage(data: Uint8Array, mimeType: string): DecodedRasterImage {
  if (mimeType === "image/png") {
    return decodePngImage(data);
  }
  if (isJpegMimeType(mimeType)) {
    return decodeJpegImage(data);
  }
  throw new Error(`IMAGE paintFilter requires PNG or JPEG image data for SVG/React raster filtering, got ${mimeType}`);
}

function isPngMimeType(mimeType: string): boolean {
  return mimeType === "image/png";
}

function resolveRasterSourceProfileFromMetadata(
  metadata: Pick<PngImageMetadata, "iccProfile" | "srgbIntent">,
): ImagePixelColorSpace {
  if (metadata.iccProfile) {
    return recognizeImagePixelColorSpace(metadata.iccProfile);
  }
  // No ICC payload — the codec layer treats absent profile as
  // sRGB-encoded pixels (matching the PNG `sRGB` chunk + the
  // browser-default fallback for ICC-less JPEG). `srgbIntent`
  // explicitly confirms that interpretation when present.
  if (metadata.srgbIntent !== undefined) {
    return { kind: "managed", profile: "SRGB" };
  }
  return { kind: "managed", profile: "SRGB" };
}

const encodedRasterSourceProfileCache = new WeakMap<Uint8Array, ImagePixelColorSpace>();

/**
 * Resolve source pixel-space classification from encoded image
 * metadata without decoding pixels. `untagged` means the file
 * carries an ICC profile that does not describe a pixel encoding
 * (e.g. an LG monitor calibration profile attached by macOS) —
 * the caller must treat the pixel bytes as untagged sRGB-equivalent
 * and skip colour conversion for them, matching browser behaviour.
 */
export function resolveEncodedRasterSourceProfile(data: Uint8Array, mimeType: string): ImagePixelColorSpace {
  const cached = encodedRasterSourceProfileCache.get(data);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = resolveUncachedEncodedRasterSourceProfile(data, mimeType);
  encodedRasterSourceProfileCache.set(data, resolved);
  return resolved;
}

function resolveUncachedEncodedRasterSourceProfile(data: Uint8Array, mimeType: string): ImagePixelColorSpace {
  if (isPngMimeType(mimeType)) {
    return resolveRasterSourceProfileFromMetadata(readPngMetadata(data));
  }
  if (isJpegMimeType(mimeType)) {
    return resolveRasterSourceProfileFromMetadata({ iccProfile: extractJpegIccProfile(data), srgbIntent: undefined });
  }
  throw new Error(`IMAGE color management requires PNG or JPEG image data, got ${mimeType}`);
}

/**
 * Resolve a decoded image's pixel-space classification.
 *
 * Returns `{ kind: "untagged" }` when the embedded ICC profile is a
 * device-tag profile (display / camera calibration) rather than a
 * pixel encoding. The fill pipeline interprets that as "the embedded
 * profile is metadata about where the image came from, not how the
 * pixels are encoded" — colour conversion is skipped for that image
 * and the pixel bytes pass through unchanged, matching what every
 * browser does with the same file.
 */
export function resolveManagedRasterSourceProfile(image: DecodedRasterImage): ImagePixelColorSpace {
  if (image.iccProfile) {
    return recognizeImagePixelColorSpace(image.iccProfile);
  }
  if (image.srgbIntent !== undefined) {
    return { kind: "managed", profile: "SRGB" };
  }
  return { kind: "managed", profile: "SRGB" };
}

/** Returns PNG metadata fields that can be preserved when re-encoding RGBA pixels. */
export function pngMetadataFromDecodedRaster(image: DecodedRasterImage): Pick<PngImage, "gamma" | "srgbIntent" | "chromaticity" | "iccProfile"> {
  return {
    gamma: image.gamma,
    srgbIntent: image.srgbIntent,
    chromaticity: image.chromaticity,
    iccProfile: image.iccProfile,
  };
}
