/**
 * @file Canvas-based metrics-only TextFontResolver for browser hosts.
 *
 * The text-rendering pipeline (`text/rendering/resolve.ts`) needs an
 * ascender ratio to compute baseline positions. When a `.fig` file
 * lacks `derivedTextData.fontMetaData` / `baselines` (real-world
 * Figma exports occasionally do), the resolver throws unless a
 * `TextFontResolver` is injected.
 *
 * In a browser host we cannot synchronously load a font file, but the
 * Canvas 2D `measureText` API exposes `fontBoundingBoxAscent` for
 * whatever font the browser will actually paint with — including its
 * substitution chain. We surface those measurements as a minimal
 * `AbstractFont`: the metrics are real, but `getPath` / `charToGlyph`
 * return empty paths so the resolver never claims it can outline the
 * text. The pipeline then falls through to the lines strategy and
 * the SVG renderer paints `<text>` elements with the same family the
 * browser just measured against — keeping layout self-consistent
 * with what the user actually sees.
 *
 * The resolver memoises results per `(family|weight|style)` triple so
 * a 100-line component does not re-issue 100 canvas measurements.
 */

import type { AbstractFont, FontPath } from "../../font/types";
import type { TextFontResolver } from "../../text/rendering";

const UNITS_PER_EM = 1000;
const MEASURE_FONT_SIZE = 100;
const MEASURE_SAMPLE = "Hg";

const EMPTY_PATH: FontPath = {
  commands: [],
  toPathData: () => "",
};

const EMPTY_GLYPH = {
  index: 0,
  advanceWidth: 0,
  getPath: (): FontPath => EMPTY_PATH,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function quoteFamily(family: string): string {
  return /^["'].*["']$/.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`;
}

function buildFontShorthand(params: {
  readonly family: string;
  readonly weight: number | undefined;
  readonly style: string | undefined;
}): string {
  const styleSegment = params.style && params.style !== "normal" ? `${params.style} ` : "";
  const weightSegment = params.weight !== undefined ? `${params.weight} ` : "";
  return `${styleSegment}${weightSegment}${MEASURE_FONT_SIZE}px ${quoteFamily(params.family)}`;
}

function readMetricsAscent(metrics: TextMetrics): number | undefined {
  if (isFiniteNumber(metrics.fontBoundingBoxAscent) && metrics.fontBoundingBoxAscent > 0) {
    return metrics.fontBoundingBoxAscent;
  }
  if (isFiniteNumber(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0) {
    return metrics.actualBoundingBoxAscent;
  }
  return undefined;
}

function readMetricsDescent(metrics: TextMetrics): number | undefined {
  if (isFiniteNumber(metrics.fontBoundingBoxDescent) && metrics.fontBoundingBoxDescent >= 0) {
    return metrics.fontBoundingBoxDescent;
  }
  if (isFiniteNumber(metrics.actualBoundingBoxDescent) && metrics.actualBoundingBoxDescent >= 0) {
    return metrics.actualBoundingBoxDescent;
  }
  return undefined;
}

function buildFontFromMetrics(ascentPx: number, descentPx: number): AbstractFont {
  const ascender = (ascentPx / MEASURE_FONT_SIZE) * UNITS_PER_EM;
  const descender = -((descentPx / MEASURE_FONT_SIZE) * UNITS_PER_EM);
  return {
    unitsPerEm: UNITS_PER_EM,
    ascender,
    descender,
    charToGlyph: () => EMPTY_GLYPH,
    getPath: () => EMPTY_PATH,
  };
}

type CanvasContextHolder = {
  context: CanvasRenderingContext2D | null;
};

function createContextHolder(): CanvasContextHolder {
  return { context: null };
}

function ensureContext(holder: CanvasContextHolder): CanvasRenderingContext2D | null {
  if (holder.context) {
    return holder.context;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  holder.context = ctx;
  return ctx;
}

/**
 * Returns true when the host can satisfy the resolver — i.e. there is
 * a DOM with `<canvas>` and `measureText` returns the bounding-box
 * fields the resolver depends on.
 */
export function isCanvasMetricsResolverSupported(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const probeCanvas = document.createElement("canvas");
  const probeCtx = probeCanvas.getContext("2d");
  if (!probeCtx) {
    return false;
  }
  probeCtx.font = `${MEASURE_FONT_SIZE}px sans-serif`;
  const sample = probeCtx.measureText(MEASURE_SAMPLE);
  return readMetricsAscent(sample) !== undefined;
}

/**
 * Build a `TextFontResolver` that supplies *metrics only* using the
 * browser's Canvas 2D `measureText` API.
 *
 * The resolver returns `undefined` when measurement fails so the
 * pipeline can fall back to its `derivedTextData` path or, if that is
 * also absent, surface a renderer error rather than silently produce
 * mis-sized glyphs.
 */
export function createCanvasMetricsTextFontResolver(): TextFontResolver {
  const holder = createContextHolder();
  const cache = new Map<string, AbstractFont | null>();

  return (request) => {
    const key = `${request.fontFamily}|${request.fontWeight ?? ""}|${request.fontStyle ?? ""}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const ctx = ensureContext(holder);
    if (!ctx) {
      cache.set(key, null);
      return undefined;
    }
    ctx.font = buildFontShorthand({
      family: request.fontFamily,
      weight: request.fontWeight,
      style: request.fontStyle,
    });
    const metrics = ctx.measureText(MEASURE_SAMPLE);
    const ascent = readMetricsAscent(metrics);
    if (ascent === undefined) {
      cache.set(key, null);
      return undefined;
    }
    const descent = readMetricsDescent(metrics) ?? 0;
    const font = buildFontFromMetrics(ascent, descent);
    cache.set(key, font);
    return font;
  };
}
