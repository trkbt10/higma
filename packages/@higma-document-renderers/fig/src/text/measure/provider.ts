/**
 * @file Measurement provider implementations
 */

import type { FontMetrics } from "@higma-document-models/fig/font";
import { buildCssFontShorthand } from "@higma-document-models/fig/font";
import type { MeasurementProvider, FontSpec, TextMeasurement } from "./types";

/** Compute cap height from actual bounding box ascent, or undefined if not available */
function computeCapHeight(
  actualBoundingBoxAscent: number | undefined,
  fontSize: number
): number | undefined {
  if (actualBoundingBoxAscent) {
    return (actualBoundingBoxAscent / fontSize) * 1000;
  }
  return undefined;
}

function requireCanvasMetric(value: number | undefined, metric: string, family: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  throw new Error(`Canvas text measurement requires ${metric} metrics for font "${family}"`);
}

function requireCanvasAscent(metrics: TextMetrics, family: string): number {
  return requireCanvasMetric(
    metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
    "ascent",
    family,
  );
}

function requireCanvasDescent(metrics: TextMetrics, family: string): number {
  return requireCanvasMetric(
    metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent,
    "descent",
    family,
  );
}

/**
 * Minimal interface for canvas context text measurement
 */
type TextMeasureContext = {
  font: string;
  measureText(text: string): TextMetrics;
};

function createTextMeasureContext(): TextMeasureContext | null {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    return canvas.getContext("2d");
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    return canvas.getContext("2d");
  }
  return null;
}

/**
 * Build CSS font string from font spec.
 *
 * Routes through the canonical `buildCssFontShorthand` SoT so the
 * shorthand format matches every Canvas measurement call site exactly.
 * Re-implementing the format locally would silently disagree on
 * family quoting (Canvas 2D rejects unquoted names with spaces) and
 * break measurement caching keyed by the shorthand itself.
 */
function buildFontString(spec: FontSpec): string {
  return buildCssFontShorthand({
    family: spec.font.family,
    weight: spec.font.weight,
    style: spec.font.style,
    fontSize: spec.fontSize,
  });
}

/**
 * Adjust width for letter spacing
 */
function adjustForLetterSpacing(
  baseWidth: number,
  charCount: number,
  letterSpacing?: number
): number {
  if (!letterSpacing || charCount <= 1) {
    return baseWidth;
  }
  // Letter spacing is applied between characters (n-1 times for n characters)
  return baseWidth + letterSpacing * (charCount - 1);
}

/**
 * Create a Canvas-based measurement provider
 *
 * Uses the Canvas 2D API for text measurement.
 * Works in browser and Node.js (with canvas package).
 */
export function createCanvasMeasurementProvider(): MeasurementProvider {
  const contextRef = { value: null as TextMeasureContext | null };

  function getContext(): TextMeasureContext {
    if (contextRef.value) {
      return contextRef.value;
    }

    contextRef.value = createTextMeasureContext();

    if (!contextRef.value) {
      throw new Error(
        "Canvas context not available. " +
          "Use a different measurement provider in non-browser environments."
      );
    }

    return contextRef.value;
  }

  return {
    measureText(text: string, spec: FontSpec): TextMeasurement {
      const ctx = getContext();
      ctx.font = buildFontString(spec);

      const metrics = ctx.measureText(text);

      const width = adjustForLetterSpacing(
        metrics.width,
        text.length,
        spec.letterSpacing
      );
      const ascent = requireCanvasAscent(metrics, spec.font.family);
      const descent = requireCanvasDescent(metrics, spec.font.family);

      return {
        width,
        height: ascent + descent,
        ascent,
        descent,
      };
    },

    measureCharWidths(text: string, spec: FontSpec): readonly number[] {
      const ctx = getContext();
      ctx.font = buildFontString(spec);

      const widths: number[] = [];
      const letterSpacing = spec.letterSpacing ?? 0;

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charWidth = ctx.measureText(char).width;
        widths.push(i < text.length - 1 ? charWidth + letterSpacing : charWidth);
      }

      return widths;
    },

    getFontMetrics(spec: FontSpec): FontMetrics {
      const ctx = getContext();
      ctx.font = buildFontString(spec);

      const metrics = ctx.measureText("Xg");

      const ascender = requireCanvasAscent(metrics, spec.font.family);
      const descender = requireCanvasDescent(metrics, spec.font.family);

      return {
        unitsPerEm: 1000,
        ascender: (ascender / spec.fontSize) * 1000,
        descender: -(descender / spec.fontSize) * 1000,
        lineGap: 0,
        capHeight: computeCapHeight(metrics.actualBoundingBoxAscent, spec.fontSize),
      };
    },
  };
}
