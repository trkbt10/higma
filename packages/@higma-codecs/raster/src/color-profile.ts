/**
 * @file sRGB / Display P3 colour-profile conversion for rasterised
 * image fills, plus ICC `desc` tag parsing for both v2 (`desc` type)
 * and v4 (`mluc` type) profiles.
 *
 * Pure colour math; no codec or renderer state. Conversion accepts and
 * returns normalised RGB samples in [0, 1].
 */

import type { FigmaExportColorProfile, IccProfile, Rgb } from "./types";

type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const SRGB_TO_XYZ_D65: Matrix3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];

const XYZ_D65_TO_SRGB: Matrix3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];

const DISPLAY_P3_TO_XYZ_D65: Matrix3 = [
  [0.48657095, 0.26566769, 0.19821729],
  [0.22897456, 0.69173852, 0.07928691],
  [0, 0.04511338, 1.04394437],
];

const XYZ_D65_TO_DISPLAY_P3: Matrix3 = [
  [2.49349691, -0.93138362, -0.40271078],
  [-0.82948897, 1.76266406, 0.02362469],
  [0.03584583, -0.07617239, 0.95688452],
];

const ICC_HEADER_LENGTH = 128;
const ICC_SIGNATURE_OFFSET = 36;
const ICC_TAG_COUNT_OFFSET = 128;
const ICC_TAG_RECORD_LENGTH = 12;
const SRGB_TRANSFER_EXPONENT = 2.4;
const SUPPORTED_SRGB_ICC_DESCRIPTIONS = new Set([
  "srgb",
  "s rgb",
  "srgb iec61966-2.1",
]);
const SUPPORTED_DISPLAY_P3_ICC_DESCRIPTIONS = new Set([
  "display p3",
  "display p3 v4",
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function decodeSrgb(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, SRGB_TRANSFER_EXPONENT);
}

function encodeSrgb(value: number): number {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * Math.pow(value, 1 / SRGB_TRANSFER_EXPONENT) - 0.055;
}

function multiplyMatrixRgb(matrix: Matrix3, color: Rgb): Rgb {
  return {
    r: matrix[0][0] * color.r + matrix[0][1] * color.g + matrix[0][2] * color.b,
    g: matrix[1][0] * color.r + matrix[1][1] * color.g + matrix[1][2] * color.b,
    b: matrix[2][0] * color.r + matrix[2][1] * color.g + matrix[2][2] * color.b,
  };
}

function sourceMatrix(profile: FigmaExportColorProfile): Matrix3 {
  if (profile === "SRGB") {
    return SRGB_TO_XYZ_D65;
  }
  return DISPLAY_P3_TO_XYZ_D65;
}

function destinationMatrix(profile: FigmaExportColorProfile): Matrix3 {
  if (profile === "SRGB") {
    return XYZ_D65_TO_SRGB;
  }
  return XYZ_D65_TO_DISPLAY_P3;
}

/** Convert a normalised RGB sample between Figma-supported RGB profiles. */
export function convertRgbColorProfile(
  color: Rgb,
  source: FigmaExportColorProfile,
  destination: FigmaExportColorProfile,
): Rgb {
  if (source === destination) {
    return color;
  }
  const linearSource = {
    r: decodeSrgb(color.r),
    g: decodeSrgb(color.g),
    b: decodeSrgb(color.b),
  };
  const xyz = multiplyMatrixRgb(sourceMatrix(source), linearSource);
  const linearDestination = multiplyMatrixRgb(destinationMatrix(destination), xyz);
  return {
    r: clamp01(encodeSrgb(linearDestination.r)),
    g: clamp01(encodeSrgb(linearDestination.g)),
    b: clamp01(encodeSrgb(linearDestination.b)),
  };
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) {
    throw new Error("ICC profile parsing requires a complete uint32 field");
  }
  return ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
}

function readAscii(data: Uint8Array, offset: number, length: number): string {
  if (offset + length > data.length) {
    throw new Error("ICC profile parsing requires a complete text field");
  }
  return String.fromCharCode(...data.slice(offset, offset + length)).replace(/\0+$/u, "");
}

function validateIccProfile(data: Uint8Array): void {
  if (data.length < ICC_HEADER_LENGTH + 4) {
    throw new Error("ICC profile requires a complete header and tag count");
  }
  if (readAscii(data, ICC_SIGNATURE_OFFSET, 4) !== "acsp") {
    throw new Error("ICC profile header is missing the acsp signature");
  }
}

// `profileDescriptionTag` always has signature `desc`. Its data type
// differs by ICC version: `desc` for v2, `mluc` for v4.
function extractDescTag(data: Uint8Array, offset: number, size: number): string {
  if (size < 12) {
    return "";
  }
  const textLength = readUint32(data, offset + 8);
  if (textLength === 0) {
    return "";
  }
  return readAscii(data, offset + 12, textLength);
}

function extractMlucTag(data: Uint8Array, offset: number, size: number): string {
  if (size < 16) {
    return "";
  }
  const count = readUint32(data, offset + 8);
  const recordSize = readUint32(data, offset + 12);
  if (recordSize < 12) {
    throw new Error("ICC mluc tag requires records of at least 12 bytes");
  }
  if (count === 0) {
    return "";
  }
  const firstRecord = offset + 16;
  const textLength = readUint32(data, firstRecord + 4);
  const textOffset = readUint32(data, firstRecord + 8);
  const absoluteTextOffset = offset + textOffset;
  if (absoluteTextOffset + textLength > offset + size) {
    throw new Error("ICC mluc tag text exceeds the tag bounds");
  }
  return decodeUtf16Be(data.slice(absoluteTextOffset, absoluteTextOffset + textLength)).replace(/\0+$/u, "");
}

function decodeUtf16Be(data: Uint8Array): string {
  if (data.length % 2 !== 0) {
    throw new Error("ICC mluc tag text requires even-length UTF-16BE data");
  }
  return Array.from({ length: data.length / 2 }, (_value, index) => (
    String.fromCharCode((data[index * 2] << 8) | data[index * 2 + 1])
  )).join("");
}

function extractIccDescription(data: Uint8Array): string | undefined {
  validateIccProfile(data);
  const tagCount = readUint32(data, ICC_TAG_COUNT_OFFSET);
  for (let index = 0; index < tagCount; index++) {
    const recordOffset = ICC_TAG_COUNT_OFFSET + 4 + index * ICC_TAG_RECORD_LENGTH;
    if (recordOffset + ICC_TAG_RECORD_LENGTH > data.length) {
      throw new Error("ICC profile tag table exceeds profile data");
    }
    const signature = readAscii(data, recordOffset, 4);
    if (signature !== "desc") {
      continue;
    }
    const tagOffset = readUint32(data, recordOffset + 4);
    const tagSize = readUint32(data, recordOffset + 8);
    if (tagOffset + tagSize > data.length) {
      throw new Error("ICC desc tag exceeds profile data");
    }
    if (tagSize < 4) {
      throw new Error("ICC desc tag is missing its type signature");
    }
    const typeSignature = readAscii(data, tagOffset, 4);
    if (typeSignature === "desc") {
      return extractDescTag(data, tagOffset, tagSize);
    }
    if (typeSignature === "mluc") {
      return extractMlucTag(data, tagOffset, tagSize);
    }
    throw new Error(`ICC desc tag has unsupported type signature: ${typeSignature}`);
  }
  return undefined;
}

/** Identify the subset of ICC profiles that the renderers can convert exactly. */
export function identifySupportedIccProfile(profile: IccProfile | undefined): FigmaExportColorProfile {
  if (!profile) {
    throw new Error("ICC profile identification requires profile data");
  }
  const description = extractIccDescription(profile.data);
  if (!description) {
    throw new Error("ICC profile is missing the required profileDescriptionTag (desc)");
  }
  const normalized = description.trim().replace(/\s+/gu, " ").toLowerCase();
  if (SUPPORTED_DISPLAY_P3_ICC_DESCRIPTIONS.has(normalized)) {
    return "DISPLAY_P3_V4";
  }
  if (SUPPORTED_SRGB_ICC_DESCRIPTIONS.has(normalized)) {
    return "SRGB";
  }
  throw new Error(`Unsupported ICC profile for image color management: ${description}`);
}
