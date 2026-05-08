/**
 * @file Measurement provider implementations
 */

import type { FontMetrics } from "../../font/index";
import { FONT_WEIGHTS } from "../../font/weight";
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

/**
 * Minimal interface for canvas context text measurement
 */
type TextMeasureContext = {
  font: string;
  measureText(text: string): TextMetrics;
};

/**
 * Build CSS font string from font spec.
 *
 * The canonical `FontQuery` is unpacked here at the boundary into the
 * `${style} ${weight} ${size}px ${family}` shorthand the Canvas 2D API
 * accepts. `style === "normal"` is omitted to match CSS shorthand defaults.
 */
function buildFontString(spec: FontSpec): string {
  const { font } = spec;
  const styleSegment = font.style !== "normal" ? `${font.style} ` : "";
  return `${styleSegment}${font.weight} ${spec.fontSize}px ${font.family}`;
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

    if (typeof document !== "undefined") {
      // Browser environment
      const canvas = document.createElement("canvas");
      contextRef.value = canvas.getContext("2d");
    } else if (typeof OffscreenCanvas !== "undefined") {
      // Web Worker or modern environment with OffscreenCanvas
      const canvas = new OffscreenCanvas(1, 1);
      contextRef.value = canvas.getContext("2d");
    }

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
      const ascent =
        metrics.fontBoundingBoxAscent ??
        metrics.actualBoundingBoxAscent ??
        spec.fontSize * 0.8;
      const descent =
        metrics.fontBoundingBoxDescent ??
        metrics.actualBoundingBoxDescent ??
        spec.fontSize * 0.2;

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

      const ascender =
        metrics.fontBoundingBoxAscent ??
        metrics.actualBoundingBoxAscent ??
        spec.fontSize * 0.8;
      const descender =
        metrics.fontBoundingBoxDescent ??
        metrics.actualBoundingBoxDescent ??
        spec.fontSize * 0.2;

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

/**
 * Create appropriate measurement provider for the current environment
 */
export function createMeasurementProvider(): MeasurementProvider {
  // Try Canvas-based provider first
  if (
    typeof document !== "undefined" ||
    typeof OffscreenCanvas !== "undefined"
  ) {
    const provider = createCanvasMeasurementProvider();
    // Probe with a minimal `FontQuery`-shaped spec so the canonical
    // descriptor is exercised end-to-end before returning the provider.
    provider.measureText("test", {
      font: { family: "sans-serif", weight: FONT_WEIGHTS.REGULAR, style: "normal" },
      fontSize: 12,
    });
    return provider;
  }

  throw new Error("Canvas measurement provider is unavailable; pass an explicit measurement provider");
}
