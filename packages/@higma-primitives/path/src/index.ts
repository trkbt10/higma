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
export {
  pathCommandsToSvgPath,
  contourToSvgD,
  matrixToSvgTransform,
} from "./serialize-svg";
export { transformPathCommands } from "./transform";
export { pathCommandsBoundingBox, pathContoursBoundingBox } from "./bbox";
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

export {
  buildRoundedRectPathD,
  buildSmoothedRoundedRectPathD,
  CORNER_KAPPA,
} from "./svg-rounded-rect";
export { buildEllipseArcPathD, type ArcData } from "./svg-ellipse-arc";
export { clampCornerRadius, cornerRadiusScalar } from "./corner-radius";
export {
  reconstructStrokeCenterline,
  type CenterlineContour,
} from "./stroke-centerline";
export {
  buildStrokeAlignedClosedPathCommands,
  buildStrokeGeometryBackedInsideStrokeCenterlineCommands,
  buildStrokeGeometryBackedOutsideStrokeCenterlineCommands,
  type StrokeAlignedClosedPathOptions,
} from "./stroke-aligned-path";

export {
  evaluateBooleanPathResult,
  evaluateBooleanPaths,
  isBooleanOperationName,
  type BooleanOperationType,
  type BooleanPathInput,
  type BooleanEvaluationError,
  type BooleanEvaluationResult,
} from "./boolean";
