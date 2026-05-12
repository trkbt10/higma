/**
 * @file PNG Module
 *
 * Pure TypeScript PNG encoder/decoder. Environment-independent.
 */

export { encodeRgbaToPngDataUrl, encodeRgbaToPng } from "./encoder";
export { isPng } from "./detector";
export { PNG_SIGNATURE } from "./constants";
export { pack as packPng } from "./pngjs";
export { parseSync as parsePng } from "./pngjs";
export type { PngChromaticity, PngIccProfile, PngData, PackerOptions } from "./pngjs";
export type { ParseResult, ParseOptions } from "./pngjs";
export { createPngImage, readPng, writePng, type PngImage } from "./png-image";
