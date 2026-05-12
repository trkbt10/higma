/** @file Raster image decoding (PNG via @higma-codecs/png, JPEG via jpeg-js). */

import { readPng, readPngMetadata, type PngImage, type PngImageMetadata } from "@higma-codecs/png";
import { decode as decodeJpeg } from "jpeg-js";
import {
  extractJpegIccProfile,
  identifySupportedIccProfile,
  type FigmaExportColorProfile,
  type IccProfile,
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
): FigmaExportColorProfile {
  if (metadata.iccProfile) {
    return identifySupportedIccProfile(metadata.iccProfile);
  }
  if (metadata.srgbIntent !== undefined) {
    return "SRGB";
  }
  return "SRGB";
}

const encodedRasterSourceProfileCache = new WeakMap<Uint8Array, FigmaExportColorProfile>();

/** Resolve source color profile from encoded image metadata without decoding pixels. */
export function resolveEncodedRasterSourceProfile(data: Uint8Array, mimeType: string): FigmaExportColorProfile {
  const cached = encodedRasterSourceProfileCache.get(data);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = resolveUncachedEncodedRasterSourceProfile(data, mimeType);
  encodedRasterSourceProfileCache.set(data, resolved);
  return resolved;
}

function resolveUncachedEncodedRasterSourceProfile(data: Uint8Array, mimeType: string): FigmaExportColorProfile {
  if (isPngMimeType(mimeType)) {
    return resolveRasterSourceProfileFromMetadata(readPngMetadata(data));
  }
  if (isJpegMimeType(mimeType)) {
    return resolveRasterSourceProfileFromMetadata({ iccProfile: extractJpegIccProfile(data), srgbIntent: undefined });
  }
  throw new Error(`IMAGE color management requires PNG or JPEG image data, got ${mimeType}`);
}

/** Resolve an image's managed source profile using explicit metadata. */
export function resolveManagedRasterSourceProfile(image: DecodedRasterImage): FigmaExportColorProfile {
  if (image.iccProfile) {
    return identifySupportedIccProfile(image.iccProfile);
  }
  if (image.srgbIntent !== undefined) {
    return "SRGB";
  }
  return "SRGB";
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
