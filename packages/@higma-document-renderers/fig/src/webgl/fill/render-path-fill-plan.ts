/** @file WebGL path fill plan derived from RenderTree path contours. */

import type { Fill, PathContour, Color } from "@higma-document-renderers/fig/scene-graph";
import type { RenderPathContour, ResolvedFillDef, ResolvedFillResult } from "../../scene-graph";
import { svgPathDToContours } from "../tessellation/path-contours";

export type WebGLPathFillRule = "evenodd" | "nonzero";

export type WebGLPathFillInstruction = {
  readonly contours: readonly PathContour[];
  readonly fillRule: WebGLPathFillRule;
  readonly fills: readonly Fill[];
};

export type WebGLPathFillPlanSource = {
  readonly paths: readonly RenderPathContour[];
  readonly sourceFills: readonly Fill[];
};

function parseSvgCoordinate(value: string | undefined, defaultValue: number): number {
  if (!value) { return defaultValue; }
  if (value.endsWith("%")) {
    const parsed = Number(value.slice(0, -1));
    return Number.isFinite(parsed) ? parsed / 100 : defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function hexToColor(hex: string): Color {
  if (hex === "none") { return { r: 0, g: 0, b: 0, a: 0 }; }
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseStopOffset(value: string): number {
  return parseSvgCoordinate(value, 0);
}

function resolvedGradientDefToFill(def: ResolvedFillDef | undefined): Fill | undefined {
  if (!def) { return undefined; }
  switch (def.type) {
    case "linear-gradient":
      return {
        type: "linear-gradient",
        start: { x: parseSvgCoordinate(def.x1, 0), y: parseSvgCoordinate(def.y1, 0.5) },
        end: { x: parseSvgCoordinate(def.x2, 1), y: parseSvgCoordinate(def.y2, 0.5) },
        stops: def.stops.map((stop) => ({
          position: parseStopOffset(stop.offset),
          color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
        })),
        opacity: 1,
      };
    case "radial-gradient":
      return {
        type: "radial-gradient",
        center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
        radius: parseSvgCoordinate(def.r, 0.5),
        stops: def.stops.map((stop) => ({
          position: parseStopOffset(stop.offset),
          color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
        })),
        opacity: 1,
      };
    case "angular-gradient":
      return {
        type: "angular-gradient",
        center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
        rotation: def.rotation,
        stops: def.stops.map((stop) => ({
          position: parseStopOffset(stop.offset),
          color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
        })),
        opacity: 1,
      };
    case "diamond-gradient":
      return {
        type: "diamond-gradient",
        center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
        stops: def.stops.map((stop) => ({
          position: parseStopOffset(stop.offset),
          color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
        })),
        opacity: 1,
      };
    case "image":
      return undefined;
  }
}

/** Convert a RenderTree per-contour fill override to WebGL paint data. */
export type WebGLFillOverrideResolution = {
  readonly fills: readonly Fill[];
};

/** Convert a RenderTree per-contour fill override to WebGL paint data. */
export function resolvedFillOverrideToWebGLFills(
  fillOverride: ResolvedFillResult | undefined,
  sourceFills: readonly Fill[],
): WebGLFillOverrideResolution {
  if (!fillOverride) { return { fills: sourceFills }; }
  const gradientFill = resolvedGradientDefToFill(fillOverride.def);
  if (gradientFill) { return { fills: [gradientFill] }; }
  const fill = fillOverride.attrs.fill;
  if (fill === "none") { return { fills: [] }; }
  if (fill.startsWith("#")) {
    return { fills: [{
      type: "solid",
      color: hexToColor(fill),
      opacity: fillOverride.attrs.fillOpacity ?? 1,
    }] };
  }
  throw new Error(`WebGL path fill plan does not support fillOverride ${fill}`);
}

/** Build one WebGL fill instruction per RenderTree path contour. */
export function createWebGLPathFillPlan(source: WebGLPathFillPlanSource): readonly WebGLPathFillInstruction[] {
  return source.paths.map((pathContour) => {
    const fillRule: WebGLPathFillRule = pathContour.fillRule === "evenodd" ? "evenodd" : "nonzero";
    const fillResolution = resolvedFillOverrideToWebGLFills(pathContour.fillOverride, source.sourceFills);
    return {
      contours: svgPathDToContours({ d: pathContour.d, windingRule: fillRule }),
      fillRule,
      fills: fillResolution.fills,
    };
  });
}
