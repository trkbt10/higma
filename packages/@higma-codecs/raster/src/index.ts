/**
 * @file Public surface of `@higma-codecs/raster` — Figma-parity raster
 * operations (decode, dimension probing, resampling, colour-profile
 * conversion, paint-filter transfer). Codec layer: pure pixel math,
 * no renderer-side state.
 */

export type {
  FigmaExportColorProfile,
  FigmaImageResamplingMethod,
  IccProfile,
  ImagePaintFilter,
  RasterImageMetadata,
  Rgb,
  RgbaRaster,
} from "./types";

export { getImageDimensions, type ImageDimensions } from "./image-dimensions";

export { resampleImage, type ResampleImageOptions } from "./image-resample";

export {
  convertRgbColorProfile,
  identifySupportedIccProfile,
} from "./color-profile";

export { extractJpegIccProfile } from "./jpeg-icc";

export {
  applyImagePaintFilterToRgb,
  assertImagePaintFilterSupported,
  createImagePaintFilterTables,
  hasImagePaintFilter,
  resolveImagePaintFilterUniforms,
  type ImagePaintFilterUniforms,
  IDENTITY_IMAGE_PAINT_FILTER_UNIFORMS,
} from "./image-paint-filter";
