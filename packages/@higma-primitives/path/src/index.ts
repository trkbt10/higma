/**
 * @file Public surface of `@higma-primitives/path` — domain-free 2D
 * path operations shared by every higma package.
 */

export type {
  AffineMatrix,
  Bbox,
  CornerRadius,
  PathCommand,
  PathContour,
  SvgPathOptions,
} from "./types";

export { parseSvgPathD } from "./parse-svg";
export { pathCommandsToSvgPath } from "./serialize-svg";
export { transformPathCommands } from "./transform";
export { pathCommandsBoundingBox } from "./bbox";
export { flattenPathCommands, flattenCubicBezier, flattenQuadBezier } from "./flatten";
export { arcToCubicBeziers, type CubicBezierSegment, type SvgArcParams } from "./arc";
export { convertQuadraticsToCubic } from "./bezier";
export { countSubpaths } from "./count";

export {
  generateRectContour,
  generateEllipseContour,
  generatePolygonContour,
  generateStarContour,
  generateLineContour,
  type GenerateStarContourOptions,
  KAPPA,
} from "./contours";
