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

export type { ParsedFigFile, FigImage } from "./fig-file";

export {
  buildNodeTree,
  guidToString,
  parseGuidString,
  getNodeType,
  findNodesByType,
  findNodeByGuid,
  safeChildren,
} from "./tree-builder";

export type { FigGuid, NodeTreeResult } from "./tree-builder";

export {
  decodePathCommands,
  pathCommandsToSvgPath,
  decodeBlobToSvgPath,
} from "./blob-decoder";

export type { FigBlob, PathCommand, SvgPathOptions } from "./blob-decoder";

export {
  normaliseNodeChanges,
  denormaliseNodeForEncode,
  asBlobArray,
} from "./normalize";
