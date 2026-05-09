/**
 * @file PNG Module
 *
 * Pure TypeScript PNG encoder/decoder. Environment-independent.
 */

export { encodeRgbaToPngDataUrl, encodeRgbaToPng } from "./encoder";
export { isPng } from "./detector";
export { PNG_SIGNATURE } from "./constants";
export { pack as packPng } from "./pngjs/packer";
export { parseSync as parsePng } from "./pngjs/parser-sync";
export type { PngChromaticity, PngIccProfile, PngData, PackerOptions } from "./pngjs/packer";
export type { ParseResult, ParseOptions } from "./pngjs/parser-sync";
export { createPngImage, readPng, writePng, type PngImage } from "./png-image";
