/**
 * @file Scene graph converters
 *
 * Convert Figma node properties to format-agnostic scene graph types.
 *
 * `parseSvgPathD` and the primitive contour generators
 * (`generateRectContour`, …, `generateLineContour`) live in
 * `@higma-primitives/path`; consumers import them directly from the
 * primitive package. The custom `no-cross-package-reexport` rule
 * forbids re-publishing them through this barrel.
 */

export { figColorToSceneColor, convertPaintToFill, convertPaintsToFills } from "./fill";
export { convertStrokeToSceneStroke } from "./stroke";
export { convertEffectsToScene } from "./effects";
export { decodeGeometryToContours, convertVectorPathsToContours } from "./path";
export { convertTextNode, type TextConversionResult } from "./text";
export { convertFigmaBlendMode } from "./blend-mode";
