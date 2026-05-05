/**
 * @file Public entry point for fig-family ZIP package mechanics
 */

export {
  createFigPackage,
  extractFigPackageContents,
  isZipPackage,
  type FigPackageContents,
} from "./package";

export {
  buildFigPackageMetadataJson,
  parseFigPackageMetadata,
  type FigPackageMetadata,
} from "./metadata";

export {
  getFigPackageImageMimeType,
  getMimeTypeFromContent,
  getMimeTypeFromPath,
  type FigPackageImage,
} from "./image";
