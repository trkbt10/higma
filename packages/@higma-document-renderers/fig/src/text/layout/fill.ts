/**
 * @file Text fill color handling
 */

import type { FigPaint } from "@higma-document-models/fig/types";
import { figColorToHex, asSolidPaint } from "@higma-document-models/fig/color";
import { convertFigmaBlendMode } from "@higma-document-models/fig/scene-graph";
import type { FillColorResult } from "./types";

/**
 * Default fill color for text (black)
 */
const DEFAULT_FILL: FillColorResult = { color: "#000000", opacity: 1 };

/**
 * Get fill color and opacity from paints for text nodes
 *
 * For text, we only support solid colors. Gradients and images
 * are not applied to text fills.
 *
 * @param paints - Array of fill paints from the node
 * @returns Fill color (hex) and opacity
 */
export function getFillColorAndOpacity(paints: readonly FigPaint[] | undefined): FillColorResult {
  if (!paints || paints.length === 0) {
    return DEFAULT_FILL;
  }

  const firstPaint = paints.find((p) => p.visible !== false);
  if (!firstPaint) {
    return DEFAULT_FILL;
  }

  const solidPaint = asSolidPaint(firstPaint);
  if (!solidPaint) {
    return DEFAULT_FILL;
  }

  return {
    color: figColorToHex(solidPaint.color),
    opacity: firstPaint.opacity ?? 1,
  };
}

/**
 * Get every visible solid fill from a paint list, in paint-order.
 *
 * Figma allows a text node to carry multiple stacked fills. Its own SVG
 * exporter emits the glyph path once per fill so the painter's-algorithm
 * composite of the stack produces the final colour: e.g. a `[{black,
 * opacity=0.15}, {black, opacity=1.0}]` stack lands as one faint black
 * pass followed by one fully-opaque black pass, yielding solid black
 * text in the final raster.
 *
 * `getFillColorAndOpacity` (single-fill) is preserved for callers that
 * still want a flat colour answer; this helper is for renderers that
 * must mirror the stack semantically.
 *
 * Returns an empty array when no visible solid fill exists; callers
 * decide whether to fall back to `DEFAULT_FILL` or emit nothing.
 */
export function getAllVisibleSolidFills(
  paints: readonly FigPaint[] | undefined,
): readonly FillColorResult[] {
  if (!paints || paints.length === 0) {
    return [];
  }
  const out: FillColorResult[] = [];
  for (const paint of paints) {
    if (paint.visible === false) { continue; }
    const solid = asSolidPaint(paint);
    if (!solid) { continue; }
    // Per-paint `blendMode` is required to match Figma's stacked-text
    // composite. The Figma raw enum maps to the lowercase CSS-friendly
    // token via `convertFigmaBlendMode`; `NORMAL` / `PASS_THROUGH` map
    // to `undefined`, so the renderer's emit path can branch on
    // "explicit non-normal blend" without re-mapping at the call site.
    const blendMode = convertFigmaBlendMode(paint.blendMode);
    out.push({
      color: figColorToHex(solid.color),
      opacity: paint.opacity ?? 1,
      ...(blendMode === undefined ? {} : { blendMode }),
    });
  }
  return out;
}
