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

function requireCanvasAscent(metrics: CanvasTextMetrics, family: string): number {
  return requireCanvasMetric(
    metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
    "ascent",
    family,
  );
}

function requireCanvasDescent(metrics: CanvasTextMetrics, family: string): number {
  return requireCanvasMetric(
    metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent,
    "descent",
    family,
  );
}

export type CanvasTextMetrics = {
  readonly width: number;
  readonly actualBoundingBoxAscent?: number;
  readonly actualBoundingBoxDescent?: number;
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
};

/**
 * Minimal interface for canvas context text measurement.
 */
export type CanvasTextMeasureContext = {
  font: string;
  measureText(text: string): CanvasTextMetrics;
};

export type CanvasMeasurementProviderInput = {
  readonly context: CanvasTextMeasureContext;
};

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
export function createCanvasMeasurementProvider({ context }: CanvasMeasurementProviderInput): MeasurementProvider {
  return {
    measureText(text: string, spec: FontSpec): TextMeasurement {
      context.font = buildFontString(spec);

      const metrics = context.measureText(text);

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
      context.font = buildFontString(spec);

      const letterSpacing = spec.letterSpacing ?? 0;
      return Array.from({ length: text.length }, (_entry, index) => {
        const char = text[index];
        const charWidth = context.measureText(char).width;
        if (index < text.length - 1) {
          return charWidth + letterSpacing;
        }
        return charWidth;
      });
    },

    getFontMetrics(spec: FontSpec): FontMetrics {
      context.font = buildFontString(spec);

      const metrics = context.measureText("Xg");

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
