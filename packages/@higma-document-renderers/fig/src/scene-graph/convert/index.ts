/** @file Scene graph converters — Figma node properties to format-agnostic scene graph types. */

export { figColorToSceneColor, convertPaintToFill, convertPaintsToFills } from "./fill";
export { convertStrokeToSceneStroke } from "./stroke";
export { convertEffectsToScene } from "./effects";
export { decodeGeometryToContours, convertVectorPathsToContours, type DecodedContour } from "./path";
export { convertTextNode, type TextConversionResult } from "./text";
