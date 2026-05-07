/** @file Raster image decoding for SVG/React image paint filtering. */

import { readPng, type PngImage } from "@higma-codecs/png";
import { decode as decodeJpeg } from "jpeg-js";

export type DecodedRasterImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly gamma?: number;
  readonly srgbIntent?: number;
  readonly chromaticity?: PngImage["chromaticity"];
  readonly iccProfile?: PngImage["iccProfile"];
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

/** Returns PNG metadata fields that can be preserved when re-encoding RGBA pixels. */
export function pngMetadataFromDecodedRaster(image: DecodedRasterImage): Pick<PngImage, "gamma" | "srgbIntent" | "chromaticity" | "iccProfile"> {
  return {
    gamma: image.gamma,
    srgbIntent: image.srgbIntent,
    chromaticity: image.chromaticity,
    iccProfile: image.iccProfile,
  };
}

type JpegIccSegment = {
  readonly sequence: number;
  readonly count: number;
  readonly data: Uint8Array;
};

const JPEG_MARKER_SOI = 0xd8;
const JPEG_MARKER_EOI = 0xd9;
const JPEG_MARKER_SOS = 0xda;
const JPEG_MARKER_APP2 = 0xe2;
const JPEG_ICC_PROFILE_PREFIX = new Uint8Array([
  0x49,
  0x43,
  0x43,
  0x5f,
  0x50,
  0x52,
  0x4f,
  0x46,
  0x49,
  0x4c,
  0x45,
  0x00,
]);

/** Extract a JPEG APP2 ICC profile without decoding pixel data. */
export function extractJpegIccProfile(data: Uint8Array): PngImage["iccProfile"] | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== JPEG_MARKER_SOI) {
    throw new Error("JPEG ICC profile extraction requires a JPEG SOI marker");
  }
  return assembleJpegIccProfile(readJpegIccSegments(data, 2, []));
}

function readJpegIccSegments(data: Uint8Array, offset: number, segments: readonly JpegIccSegment[]): readonly JpegIccSegment[] {
  if (offset >= data.length) {
    return segments;
  }
  const markerOffset = skipJpegFillBytes(data, offset);
  const marker = data[markerOffset + 1];
  if (markerOffset + 1 >= data.length || data[markerOffset] !== 0xff || marker === undefined) {
    throw new Error("JPEG segment parsing requires a marker byte");
  }
  if (marker === JPEG_MARKER_EOI || marker === JPEG_MARKER_SOS) {
    return segments;
  }
  if (markerOffset + 4 > data.length) {
    throw new Error("JPEG segment parsing requires a segment length");
  }
  const segmentLength = (data[markerOffset + 2] << 8) | data[markerOffset + 3];
  if (segmentLength < 2) {
    throw new Error("JPEG segment length must include the length field");
  }
  const payloadStart = markerOffset + 4;
  const payloadEnd = markerOffset + 2 + segmentLength;
  if (payloadEnd > data.length) {
    throw new Error("JPEG segment length exceeds file data");
  }
  const segment = marker === JPEG_MARKER_APP2 ? parseJpegIccSegment(data.slice(payloadStart, payloadEnd)) : undefined;
  return readJpegIccSegments(data, payloadEnd, appendJpegIccSegment(segments, segment));
}

function skipJpegFillBytes(data: Uint8Array, offset: number): number {
  if (offset >= data.length || data[offset] !== 0xff || data[offset + 1] !== 0xff) {
    return offset;
  }
  return skipJpegFillBytes(data, offset + 1);
}

function appendJpegIccSegment(
  segments: readonly JpegIccSegment[],
  segment: JpegIccSegment | undefined,
): readonly JpegIccSegment[] {
  if (!segment) {
    return segments;
  }
  return [...segments, segment];
}

function parseJpegIccSegment(payload: Uint8Array): JpegIccSegment | undefined {
  if (!startsWith(payload, JPEG_ICC_PROFILE_PREFIX)) {
    return undefined;
  }
  const sequence = payload[JPEG_ICC_PROFILE_PREFIX.length];
  const count = payload[JPEG_ICC_PROFILE_PREFIX.length + 1];
  if (sequence === undefined || count === undefined || sequence < 1 || count < 1 || sequence > count) {
    throw new Error("JPEG ICC APP2 segment has invalid sequence metadata");
  }
  return {
    sequence,
    count,
    data: payload.slice(JPEG_ICC_PROFILE_PREFIX.length + 2),
  };
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) {
    return false;
  }
  return prefix.every((byte, index) => data[index] === byte);
}

function assembleJpegIccProfile(segments: readonly JpegIccSegment[]): PngImage["iccProfile"] | undefined {
  if (segments.length === 0) {
    return undefined;
  }
  const count = segments[0].count;
  if (segments.some((segment) => segment.count !== count)) {
    throw new Error("JPEG ICC APP2 segments disagree on total segment count");
  }
  if (segments.length !== count) {
    throw new Error("JPEG ICC APP2 profile is missing segments");
  }
  const bySequence = new Map(segments.map((segment) => [segment.sequence, segment]));
  if (bySequence.size !== segments.length) {
    throw new Error("JPEG ICC APP2 profile contains duplicate segments");
  }
  return {
    name: "ICC Profile",
    data: concatJpegIccSegments(Array.from({ length: count }, (_value, index) => {
      const segment = bySequence.get(index + 1);
      if (!segment) {
        throw new Error("JPEG ICC APP2 profile sequence is incomplete");
      }
      return segment.data;
    })),
  };
}

function concatJpegIccSegments(segments: readonly Uint8Array[]): Uint8Array {
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const out = new Uint8Array(totalLength);
  segments.reduce((offset, segment) => {
    out.set(segment, offset);
    return offset + segment.length;
  }, 0);
  return out;
}
