/**
 * @file Stroke resolution — shared SoT for SceneGraph Stroke → SVG stroke attributes
 *
 * Both SVG string and React renderers MUST consume this output.
 */

import type { Stroke, StrokeLayer, BlendMode } from "@higma-document-renderers/fig/scene-graph";
import { colorToHex } from "./color";
import { resolveFigmaSvgOpacity } from "./figma-svg-opacity";
import { resolveFill, type IdGenerator, type ResolvedFill } from "./fill";

// =============================================================================
// Resolved Types
// =============================================================================

/**
 * SVG stroke attributes resolved from a SceneGraph Stroke.
 * Field names match SVG attribute names (camelCase for React, kebab-case consumers convert).
 */
export type ResolvedStrokeAttrs = {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity?: number;
  readonly strokeLinecap?: "round" | "square";
  readonly strokeLinejoin?: "round" | "bevel";
  readonly strokeDasharray?: string;
  /**
   * Stroke alignment. When INSIDE or OUTSIDE, the SVG stroke-width is
   * doubled and a mask clips the stroke to the correct side of the path.
   */
  readonly strokeAlign?: "INSIDE" | "OUTSIDE";
};

/**
 * A resolved stroke layer for multi-paint stroke rendering.
 * Each layer can have its own color/gradient and blend mode.
 */
export type ResolvedStrokeLayer = {
  readonly attrs: ResolvedStrokeAttrs;
  /** Gradient def, if this layer uses a gradient stroke */
  readonly gradientDef?: ResolvedFill["def"];
  /** Paint-level blend mode */
  readonly blendMode?: BlendMode;
};

/**
 * Complete stroke resolution result, including multi-paint layers.
 */
export type ResolvedStrokeResult = {
  /** Primary stroke attrs (for single-paint rendering) */
  readonly attrs: ResolvedStrokeAttrs;
  /** All stroke layers when multi-paint (length >= 2, bottom-to-top) */
  readonly layers?: readonly ResolvedStrokeLayer[];
};

// =============================================================================
// Resolution
// =============================================================================

/**
 * SVG stroke width for the given alignment.
 * INSIDE/OUTSIDE strokes are rendered at 2× width; a mask clips to the correct half.
 */
function alignedStrokeWidth(width: number, align: Stroke["align"]): number {
  return (align === "INSIDE" || align === "OUTSIDE") ? width * 2 : width;
}

/** Normalize StrokeAlign to the subset stored on resolved attrs (CENTER → undefined). */
function resolvedAlign(align: Stroke["align"]): ResolvedStrokeAttrs["strokeAlign"] {
  return align === "INSIDE" || align === "OUTSIDE" ? align : undefined;
}

function buildStrokeAttrsBase(stroke: Stroke): Omit<ResolvedStrokeAttrs, "stroke" | "strokeOpacity"> {
  return {
    strokeWidth: alignedStrokeWidth(stroke.width, stroke.align),
    strokeLinecap: stroke.linecap !== "butt" ? stroke.linecap : undefined,
    strokeLinejoin: stroke.linejoin !== "miter" ? stroke.linejoin : undefined,
    strokeDasharray: stroke.dashPattern?.join(" "),
    strokeAlign: resolvedAlign(stroke.align),
  };
}

/**
 * Resolve a Stroke to SVG stroke attributes.
 */
export function resolveStroke(stroke: Stroke): ResolvedStrokeAttrs {
  return {
    stroke: colorToHex(stroke.color),
    strokeWidth: alignedStrokeWidth(stroke.width, stroke.align),
    strokeOpacity: stroke.opacity < 1 ? resolveFigmaSvgOpacity(stroke.opacity) : undefined,
    strokeLinecap: stroke.linecap !== "butt" ? stroke.linecap : undefined,
    strokeLinejoin: stroke.linejoin !== "miter" ? stroke.linejoin : undefined,
    strokeDasharray: stroke.dashPattern?.join(" "),
    strokeAlign: resolvedAlign(stroke.align),
  };
}

/**
 * Resolve a Stroke including multi-paint layers.
 *
 * When the stroke has layers, each is resolved individually
 * (potentially with gradient fill). Returns a ResolvedStrokeResult
 * with both primary attrs and individual layers.
 */
export function resolveStrokeResult(stroke: Stroke, ids: IdGenerator): ResolvedStrokeResult {
  const attrs = resolveStroke(stroke);

  const singleLayerResult = resolveSingleStrokeLayerResult(stroke, attrs, ids);
  if (singleLayerResult !== undefined) {
    return singleLayerResult;
  }

  if (!hasMultipleStrokeLayers(stroke.layers)) {
    return { attrs };
  }

  const base = buildStrokeAttrsBase(stroke);
  const layers = stroke.layers.map((layer) => resolveStrokeLayer(layer, base, ids));

  return { attrs, layers };
}

function hasMultipleStrokeLayers(layers: readonly StrokeLayer[] | undefined): layers is readonly [StrokeLayer, StrokeLayer, ...StrokeLayer[]] {
  return layers !== undefined && layers.length >= 2;
}

function resolveSingleStrokeLayerResult(
  stroke: Stroke,
  fallbackAttrs: ResolvedStrokeAttrs,
  ids: IdGenerator,
): ResolvedStrokeResult | undefined {
  const layer = stroke.layers?.[0];
  if (layer === undefined) {
    return undefined;
  }
  if (layer.gradientFill === undefined && layer.blendMode === undefined) {
    return undefined;
  }

  const base = buildStrokeAttrsBase(stroke);
  const resolvedLayer = resolveStrokeLayer(layer, base, ids);

  if (layer.gradientFill !== undefined) {
    return { attrs: resolvedLayer.attrs, layers: [resolvedLayer] };
  }

  // Single SOLID layer with a defined (non-default) paint blend mode:
  // the uniform-stroke path emits stroke attrs without `mix-blend-mode`,
  // which would silently drop Figma's per-paint stroke blend
  // (a SOFT_LIGHT-blended white outline stroke). The BlendMode union
  // does not include "normal" — convertFigmaBlendMode maps NORMAL to
  // undefined, so a defined `layer.blendMode` is by construction a
  // non-default blend. Emitting a single-layer result routes through
  // the layered renderer, which wraps the stroke draw in a styled
  // element and preserves the blend mode.
  return { attrs: fallbackAttrs, layers: [resolvedLayer] };
}

function resolveStrokeLayer(
  layer: StrokeLayer,
  base: Omit<ResolvedStrokeAttrs, "stroke" | "strokeOpacity">,
  ids: IdGenerator,
): ResolvedStrokeLayer {
  if (layer.gradientFill !== undefined) {
    const resolved = resolveFill(layer.gradientFill, ids);
    return {
      attrs: buildStrokeLayerAttrs(base, resolved.attrs.fill, layer.opacity),
      gradientDef: resolved.def,
      blendMode: layer.blendMode,
    };
  }
  return {
    attrs: buildStrokeLayerAttrs(base, colorToHex(layer.color), layer.opacity),
    blendMode: layer.blendMode,
  };
}

function buildStrokeLayerAttrs(
  base: Omit<ResolvedStrokeAttrs, "stroke" | "strokeOpacity">,
  stroke: string,
  opacity: number,
): ResolvedStrokeAttrs {
  return {
    ...base,
    stroke,
    strokeOpacity: opacity < 1 ? resolveFigmaSvgOpacity(opacity) : undefined,
  };
}
