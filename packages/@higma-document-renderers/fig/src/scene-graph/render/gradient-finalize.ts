/**
 * @file Gradient coordinate finalization
 *
 * Converts gradient defs from objectBoundingBox percentages to
 * userSpaceOnUse pixel coordinates when the original Figma gradient
 * transform matrix is available.
 *
 * This module exists because gradient coordinate resolution depends on
 * two inputs that live at different levels:
 *   1. The Fill data (gradient stops, transform matrix) — known at fill level
 *   2. The element bounds (x, y, width, height) — known at node level
 *
 * resolveFill() produces ResolvedFillDef with the raw gradientTransform
 * preserved. This module's finalizeGradientDefs() is called by the node
 * resolver to apply the element size and produce final coordinates.
 *
 * Architecture:
 *   resolveFill(fill) → ResolvedFillDef (with raw transform)
 *       ↓
 *   finalizeGradientDefs(defs, elementBounds) ← called in node resolver
 *       ↓
 *   ResolvedFillDef (with userSpaceOnUse pixel coordinates)
 */


import type { ResolvedLinearGradient, ResolvedRadialGradient } from "./fill";
import type { RenderDef } from "../render-tree";
import {
  linearGradientAttrs as svgLinearGradientAttrs,
  radialGradientAttrs as svgRadialGradientAttrs,
} from "../../paint";
import type { AffineMatrix } from "@higma-primitives/path";

/**
 * Extract the raw affine matrix from a ResolvedGradient's
 * `gradientTransform` field.
 *
 * Before finalization the field carries an `AffineMatrix`; after it's
 * an SVG string. The callers below only ever operate on the
 * pre-finalized shape, so we pull out the matrix if present and
 * return undefined when the def has already been consumed (string) or
 * was never given a transform.
 */
function gradientMatrixFromDef(
  value: string | AffineMatrix | undefined,
): AffineMatrix | undefined {
  if (value === undefined) { return undefined; }
  if (typeof value === "string") { return undefined; }
  return value;
}

/**
 * Element bounding box for gradient coordinate computation.
 *
 * FRAME / RECTANGLE / ELLIPSE / TEXT pass explicit `(0, 0, width,
 * height)` bounds because their coordinate systems begin at the
 * node's top-left. VECTOR paths pass their contour bbox so the
 * gradient origin lines up with the path's actual extent.
 */
export type ElementSize = { readonly width: number; readonly height: number };
export type ElementBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/**
 * Finalize gradient defs by converting from objectBoundingBox to
 * userSpaceOnUse when gradientTransform data is available.
 *
 * Mutates the defs array in place (replaces gradient def objects).
 * Non-gradient defs are left unchanged.
 */
export function finalizeGradientDefs(
  defs: RenderDef[],
  elementBounds: ElementBounds,
): void {
  for (let i = 0; i < defs.length; i++) {
    const finalized = finalizeGradientDef(defs[i], elementBounds);
    if (finalized !== undefined) {
      defs[i] = finalized;
    }
  }
}

function finalizeGradientDef(def: RenderDef, elementBounds: ElementBounds): RenderDef | undefined {
  if (def.type === "linear-gradient") {
    const finalized = finalizeLinearGradient(def.def, elementBounds);
    return finalized === undefined ? undefined : { type: "linear-gradient", def: finalized };
  }
  if (def.type === "radial-gradient") {
    const finalized = finalizeRadialGradient(def.def, elementBounds);
    return finalized === undefined ? undefined : { type: "radial-gradient", def: finalized };
  }
  return undefined;
}

/**
 * Convert a linear gradient from objectBoundingBox to userSpaceOnUse.
 *
 * Delegates to the SSoT in paint/svg-gradient-transform.ts. This wrapper
 * only adapts the local ResolvedLinearGradient shape onto a minimal
 * FigGradientPaint so the SSoT can run.
 */
function finalizeLinearGradient(
  def: ResolvedLinearGradient,
  elementBounds: ElementBounds,
): ResolvedLinearGradient | undefined {
  const gt = gradientMatrixFromDef(def.gradientTransform);
  if (!gt) { return undefined; }

  const attrs = svgLinearGradientAttrs(gt, elementBounds);
  if (!attrs) { return undefined; }

  return {
    ...def,
    x1: `${attrs.x1}`,
    y1: `${attrs.y1}`,
    x2: `${attrs.x2}`,
    y2: `${attrs.y2}`,
    gradientUnits: attrs.gradientUnits,
    gradientTransform: undefined, // Consumed — coordinates are now in pixels
  };
}

/**
 * Convert a radial gradient from objectBoundingBox to userSpaceOnUse.
 *
 * Delegates to the SSoT in paint/svg-gradient-transform.ts.
 */
function finalizeRadialGradient(
  def: ResolvedRadialGradient,
  elementBounds: ElementBounds,
): ResolvedRadialGradient | undefined {
  const gt = gradientMatrixFromDef(def.gradientTransform);
  if (!gt) { return undefined; }

  const attrs = svgRadialGradientAttrs(gt, elementBounds);
  if (!attrs) { return undefined; }

  return {
    ...def,
    cx: attrs.cx,
    cy: attrs.cy,
    r: attrs.r,
    gradientUnits: attrs.gradientUnits,
    gradientTransform: attrs.gradientTransform,
  };
}
