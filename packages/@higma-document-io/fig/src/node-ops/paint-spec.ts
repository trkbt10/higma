/** @file PaintSpec → FigPaint lift. */

import type { FigPaint } from "@higma-document-models/fig/types";
import {
  BLEND_MODE_VALUES,
  PAINT_TYPE_VALUES,
  SCALE_MODE_VALUES,
  toEnumValue,
} from "@higma-document-models/fig/constants";
import type { PaintSpec } from "../types/spec-types";

/**
 * Branch helper: decides whether an entry in `NodeSpec.fills` /
 * `NodeSpec.strokes` is a (string-discriminated) `PaintSpec` or a
 * pre-built `FigPaint`. The two are distinguished by the shape of
 * the `type` field — string for spec, `{ value, name }` for FigPaint.
 */
export function isPaintSpec(paint: PaintSpec | FigPaint): paint is PaintSpec {
  return typeof paint.type === "string";
}

/**
 * Lift a `PaintSpec` to a wire-format `FigPaint`. Every enum-typed
 * field (`type`, `blendMode`, `imageScaleMode`) is resolved through
 * `toEnumValue` so the lift goes through the same single SoT helper
 * the rest of the factory uses.
 */
export function paintSpecToFig(spec: PaintSpec): FigPaint {
  const blendMode = toEnumValue(spec.blendMode ?? "NORMAL", BLEND_MODE_VALUES);
  switch (spec.type) {
    case "SOLID":
      return {
        type: toEnumValue(spec.type, PAINT_TYPE_VALUES)!,
        color: spec.color,
        opacity: spec.opacity,
        visible: spec.visible,
        opacityVar: spec.opacityVar,
        colorVar: spec.colorVar,
        blendMode,
      };
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return {
        type: toEnumValue(spec.type, PAINT_TYPE_VALUES)!,
        transform: spec.transform,
        stops: spec.stops,
        stopsVar: spec.stopsVar,
        opacity: spec.opacity,
        visible: spec.visible,
        opacityVar: spec.opacityVar,
        colorVar: spec.colorVar,
        blendMode,
      };
    case "IMAGE":
      return {
        type: toEnumValue(spec.type, PAINT_TYPE_VALUES)!,
        imageScaleMode: toEnumValue(spec.imageScaleMode, SCALE_MODE_VALUES),
        transform: spec.transform,
        scale: spec.scale,
        filterColorAdjust: spec.filterColorAdjust,
        paintFilter: spec.paintFilter,
        imageShouldColorManage: spec.imageShouldColorManage,
        rotation: spec.rotation,
        image: spec.image,
        imageVar: spec.imageVar,
        opacity: spec.opacity,
        visible: spec.visible,
        opacityVar: spec.opacityVar,
        colorVar: spec.colorVar,
        blendMode,
      };
  }
}

/**
 * Lift each entry in a mixed-form paint array. Entries that are
 * already `FigPaint` (e.g. from a codec that built the wire format
 * directly) pass through; spec entries lift via `paintSpecToFig`.
 */
export function liftPaints(
  paints: readonly (PaintSpec | FigPaint)[] | undefined,
): readonly FigPaint[] | undefined {
  if (paints === undefined) {
    return undefined;
  }
  return paints.map((p) => (isPaintSpec(p) ? paintSpecToFig(p) : p));
}

/**
 * Narrow a mixed-form entry to `FigPaint`. Used by code that holds a
 * spec-side `NodeSpec.fills` entry but needs the wire-format payload
 * (e.g. to call the paint accessors in `@higma-document-models/fig/color`).
 */
export function asFigPaint(paint: PaintSpec | FigPaint): FigPaint {
  return isPaintSpec(paint) ? paintSpecToFig(paint) : paint;
}
