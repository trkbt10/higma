/**
 * @file Export module barrel
 */

export {
  exportFig,
  type FigExportOptions,
  type FigExportResult,
} from "./fig-exporter";

export type {
  FigCanvasBounds,
  FigPreparedThumbnail,
  FigThumbnailRenderer,
  FigThumbnailRenderRequest,
  FigThumbnailRenderResult,
} from "./thumbnail-pipeline";

// `FIG_THUMBNAIL_MAX_DIMENSION` lives in `@higma-figma-containers/package`.
// Consumers must import it from there directly — re-exporting it here
// would violate the `no-cross-package-reexport` rule and create two
// import paths for the same SoT.
