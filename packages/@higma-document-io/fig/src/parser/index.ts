/**
 * @file Parser module exports
 */

export {
  decompress,
  decompressDeflate,
  decompressDeflateRaw,
  decompressZstd,
} from "./decompress";

export {
  parseFigFile,
  parseFigFileSync,
  isFigmaZipFile,
} from "./fig-file";

export type { ParsedFigFile } from "./fig-file";

export {
  readNodeChanges,
  encodeNodeForKiwi,
  asBlobArray,
} from "./node-codec";
