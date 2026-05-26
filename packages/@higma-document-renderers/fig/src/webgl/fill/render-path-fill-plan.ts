/** @file WebGL path fill plan derived from RenderTree path contours. */

import type { PathContour } from "@higma-document-renderers/fig/scene-graph";
import type { RenderPathContour, ResolvedFillResult } from "../../scene-graph";
import { svgPathDToContours } from "../tessellation/path-contours";

export type WebGLPathFillRule = "evenodd" | "nonzero";

export type WebGLPathFillInstruction = {
  readonly contours: readonly PathContour[];
  readonly fillRule: WebGLPathFillRule;
  readonly fillOverride?: ResolvedFillResult;
};

export type WebGLPathFillPlanSource = {
  readonly paths: readonly RenderPathContour[];
};

/** Build one WebGL fill instruction per RenderTree path contour. */
export function createWebGLPathFillPlan(source: WebGLPathFillPlanSource): readonly WebGLPathFillInstruction[] {
  return source.paths.map((pathContour) => {
    const fillRule: WebGLPathFillRule = pathContour.fillRule === "evenodd" ? "evenodd" : "nonzero";
    return {
      contours: svgPathDToContours({ d: pathContour.d, windingRule: fillRule }),
      fillRule,
      fillOverride: pathContour.fillOverride,
    };
  });
}
