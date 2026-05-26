/** @file WebGL render paint cache keyed by RenderTree paint objects and SVG paint attributes. */

import type { Color, Fill } from "@higma-document-renderers/fig/scene-graph";
import type { ResolvedFillDef, ResolvedFillResult } from "../../scene-graph";

export type WebGLRenderPaintCache = {
  readonly colorForHex: (hex: string) => Color;
  readonly strokeDashPattern: (dasharray: string | undefined) => readonly number[] | undefined;
  readonly fillForResolvedGradientDef: (def: ResolvedFillDef | undefined) => Fill | undefined;
  readonly fillsForResolvedFillOverride: (
    fillOverride: ResolvedFillResult | undefined,
    sourceFills: readonly Fill[],
  ) => readonly Fill[];
};

const TRANSPARENT_COLOR: Color = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const EMPTY_FILLS: readonly Fill[] = Object.freeze([]);
const SIX_DIGIT_HEX_LENGTH = 6;
const EIGHT_DIGIT_HEX_LENGTH = 8;
const HEX_COLOR_PATTERN = /^[0-9a-fA-F]+$/;

function parseHexComponent(hex: string, start: number, end: number): number {
  const parsed = Number.parseInt(hex.slice(start, end), 16);
  if (!Number.isFinite(parsed)) {
    throw new Error(`WebGL render paint cache received an invalid hex color component: ${hex}`);
  }
  return parsed / 255;
}

function parseHexColor(hex: string): Color {
  if (hex === "none") {
    return TRANSPARENT_COLOR;
  }
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  if (normalized.length !== SIX_DIGIT_HEX_LENGTH && normalized.length !== EIGHT_DIGIT_HEX_LENGTH) {
    throw new Error(`WebGL render paint cache requires #RRGGBB or #RRGGBBAA color, received: ${hex}`);
  }
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error(`WebGL render paint cache requires hex color digits, received: ${hex}`);
  }
  return Object.freeze({
    r: parseHexComponent(normalized, 0, 2),
    g: parseHexComponent(normalized, 2, 4),
    b: parseHexComponent(normalized, 4, 6),
    a: normalized.length === EIGHT_DIGIT_HEX_LENGTH ? parseHexComponent(normalized, 6, 8) : 1,
  });
}

function parseDashPattern(dasharray: string): readonly number[] | undefined {
  const parts = dasharray.split(/[\s,]+/).filter((part) => part.length > 0);
  const pattern = parts.map((part) => {
    const parsed = Number(part);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`WebGL render paint cache received an invalid stroke dash component: ${part}`);
    }
    return parsed;
  });
  if (pattern.length === 0) {
    throw new Error("WebGL render paint cache received an empty stroke dasharray");
  }
  return Object.freeze(pattern);
}

function requireFiniteSvgNumber(value: string, attributeName: string, valueKind: "coordinate" | "percentage"): number {
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`WebGL render paint cache received an invalid ${attributeName} ${valueKind}: ${value}`);
  }
  return parsedNumber;
}

function parseSvgCoordinate(value: string, attributeName: string): number {
  if (value.endsWith("%")) {
    return requireFiniteSvgNumber(value.slice(0, -1), attributeName, "percentage") / 100;
  }
  return requireFiniteSvgNumber(value, attributeName, "coordinate");
}

function parseStopOffset(value: string): number {
  return parseSvgCoordinate(value, "gradient stop offset");
}

function gradientStopColor(colorCache: Map<string, Color>, hex: string, opacity: number | undefined): Color {
  const color = cachedHexColor(colorCache, hex);
  return Object.freeze({ ...color, a: opacity ?? 1 });
}

function cachedHexColor(colorCache: Map<string, Color>, hex: string): Color {
  const cached = colorCache.get(hex);
  if (cached) {
    return cached;
  }
  const color = parseHexColor(hex);
  colorCache.set(hex, color);
  return color;
}

function buildFillFromResolvedGradientDef(
  colorCache: Map<string, Color>,
  def: ResolvedFillDef,
): Fill | undefined {
  switch (def.type) {
    case "linear-gradient":
      return Object.freeze({
        type: "linear-gradient",
        start: { x: parseSvgCoordinate(def.x1, "linear-gradient x1"), y: parseSvgCoordinate(def.y1, "linear-gradient y1") },
        end: { x: parseSvgCoordinate(def.x2, "linear-gradient x2"), y: parseSvgCoordinate(def.y2, "linear-gradient y2") },
        stops: Object.freeze(def.stops.map((stop) => Object.freeze({
          position: parseStopOffset(stop.offset),
          color: gradientStopColor(colorCache, stop.stopColor, stop.stopOpacity),
        }))),
        opacity: 1,
      });
    case "radial-gradient":
      return Object.freeze({
        type: "radial-gradient",
        center: { x: parseSvgCoordinate(def.cx, "radial-gradient cx"), y: parseSvgCoordinate(def.cy, "radial-gradient cy") },
        radius: parseSvgCoordinate(def.r, "radial-gradient r"),
        stops: Object.freeze(def.stops.map((stop) => Object.freeze({
          position: parseStopOffset(stop.offset),
          color: gradientStopColor(colorCache, stop.stopColor, stop.stopOpacity),
        }))),
        opacity: 1,
      });
    case "angular-gradient":
      return Object.freeze({
        type: "angular-gradient",
        center: { x: parseSvgCoordinate(def.cx, "angular-gradient cx"), y: parseSvgCoordinate(def.cy, "angular-gradient cy") },
        rotation: def.rotation,
        stops: Object.freeze(def.stops.map((stop) => Object.freeze({
          position: parseStopOffset(stop.offset),
          color: gradientStopColor(colorCache, stop.stopColor, stop.stopOpacity),
        }))),
        opacity: 1,
      });
    case "diamond-gradient":
      return Object.freeze({
        type: "diamond-gradient",
        center: { x: parseSvgCoordinate(def.cx, "diamond-gradient cx"), y: parseSvgCoordinate(def.cy, "diamond-gradient cy") },
        stops: Object.freeze(def.stops.map((stop) => Object.freeze({
          position: parseStopOffset(stop.offset),
          color: gradientStopColor(colorCache, stop.stopColor, stop.stopOpacity),
        }))),
        opacity: 1,
      });
    case "image":
      return undefined;
  }
}

function fillWithResolvedBlendMode(fill: Fill, blendMode: ResolvedFillResult["blendMode"]): Fill {
  if (blendMode === undefined) {
    return fill;
  }
  return Object.freeze({ ...fill, blendMode });
}

function resolveSvgFillOpacity(fillOverride: ResolvedFillResult): number {
  return fillOverride.attrs.fillOpacity ?? 1;
}

function buildFillsFromResolvedFillOverride(
  colorCache: Map<string, Color>,
  fillOverride: ResolvedFillResult,
): readonly Fill[] {
  const fillDefFills = buildFillsFromResolvedFillDefOverride(colorCache, fillOverride);
  if (fillDefFills !== undefined) {
    return fillDefFills;
  }
  const fill = fillOverride.attrs.fill;
  if (fill === "none") {
    return EMPTY_FILLS;
  }
  if (fill.startsWith("#")) {
    const solidFill: Fill = Object.freeze({
      type: "solid",
      color: cachedHexColor(colorCache, fill),
      opacity: resolveSvgFillOpacity(fillOverride),
    });
    return Object.freeze([fillWithResolvedBlendMode(solidFill, fillOverride.blendMode)]);
  }
  throw new Error(`WebGL render paint cache cannot resolve path fillOverride ${fill}`);
}

function buildFillsFromResolvedFillDefOverride(
  colorCache: Map<string, Color>,
  fillOverride: ResolvedFillResult,
): readonly Fill[] | undefined {
  if (fillOverride.def === undefined) {
    return undefined;
  }
  const gradientFill = buildFillFromResolvedGradientDef(colorCache, fillOverride.def);
  if (gradientFill === undefined) {
    return undefined;
  }
  return Object.freeze([fillWithResolvedBlendMode(gradientFill, fillOverride.blendMode)]);
}

/** Create the per-renderer cache for paint values derived from RenderTree attributes. */
export function createWebGLRenderPaintCache(): WebGLRenderPaintCache {
  const colorCache = new Map<string, Color>();
  const dashPatternCache = new Map<string, readonly number[] | undefined>();
  const fillDefCache = new WeakMap<ResolvedFillDef, Fill | null>();
  const fillOverrideCache = new WeakMap<ResolvedFillResult, readonly Fill[]>();

  return {
    colorForHex(hex) {
      return cachedHexColor(colorCache, hex);
    },

    strokeDashPattern(dasharray) {
      if (dasharray === undefined || dasharray.length === 0) {
        return undefined;
      }
      if (dashPatternCache.has(dasharray)) {
        return dashPatternCache.get(dasharray);
      }
      const pattern = parseDashPattern(dasharray);
      dashPatternCache.set(dasharray, pattern);
      return pattern;
    },

    fillForResolvedGradientDef(def) {
      if (def === undefined) {
        return undefined;
      }
      if (fillDefCache.has(def)) {
        const cached = fillDefCache.get(def);
        return cached ?? undefined;
      }
      const fill = buildFillFromResolvedGradientDef(colorCache, def);
      fillDefCache.set(def, fill ?? null);
      return fill;
    },

    fillsForResolvedFillOverride(fillOverride, sourceFills) {
      if (fillOverride === undefined) {
        return sourceFills;
      }
      const cached = fillOverrideCache.get(fillOverride);
      if (cached !== undefined) {
        return cached;
      }
      const fills = buildFillsFromResolvedFillOverride(colorCache, fillOverride);
      fillOverrideCache.set(fillOverride, fills);
      return fills;
    },
  };
}
