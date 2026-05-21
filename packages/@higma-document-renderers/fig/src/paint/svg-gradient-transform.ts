/**
 * @file SSoT: Figma paint.transform → SVG gradient attributes
 *
 * This module is the single authoritative source for converting Figma's
 * gradient paint transform matrix into SVG gradient element attributes
 * (gradientTransform for radial, x1/y1/x2/y2 for linear).
 *
 * Every caller that emits a `<linearGradient>` or `<radialGradient>` MUST
 * obtain its attributes from the functions here. Duplicating the math in
 * individual renderers (SVG string, scene-graph, React, WebGL, image-
 * pattern finalize) causes drift — a 1px sign flip in one place propagates
 * into an entire column of gradient-colour diffs because downstream
 * elements (vector fills, OVERLAY-blended world-map-style fills,
 * HUE-blended panel backgrounds) all sample the shifted gradient and composite against
 * wrong base colours.
 *
 * The output is designed to match Figma's SVG export byte-for-byte where
 * possible, so pixelmatch diffs shrink to aliasing-only variance.
 */

import type { FigGradientTransform } from "@higma-document-models/fig/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Attributes needed to construct an SVG <linearGradient> element.
 *
 * `gradientUnits` is always `"userSpaceOnUse"` — we always compute absolute
 * pixel coordinates so the gradient follows the shape regardless of
 * bounding-box quirks (objectBoundingBox has surprising behaviour with
 * stroked elements and transformed parents).
 */
export type SvgLinearGradientAttrs = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly gradientUnits: "userSpaceOnUse";
};

/**
 * Attributes needed to construct an SVG <radialGradient> element.
 *
 * The gradient is defined in a canonical form (cx=0, cy=0, r=1) and
 * positioned/shaped via `gradientTransform`. This mirrors Figma's SVG
 * export convention and keeps the transform math in one place.
 */
export type SvgRadialGradientAttrs = {
  readonly cx: "0";
  readonly cy: "0";
  readonly r: "1";
  readonly gradientUnits: "userSpaceOnUse";
  readonly gradientTransform: string;
};

/**
 * Bounds for a paint-bearing element in user space. `(x, y)` is the
 * top-left of the element's bbox; `(width, height)` is its extent.
 *
 * For FRAME / RECTANGLE / ELLIPSE / TEXT the bbox is anchored at
 * `(0, 0)` because the node's own coordinate system places its
 * top-left there. For VECTOR (paths whose first command is offset
 * inside the node) the bbox is anchored at the path's bbox top-left,
 * which Figma's gradient transform also uses as the gradient origin.
 */
export type ElementBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type SvgGradientMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

// =============================================================================
// Transform extraction
// =============================================================================

function m(t: FigGradientTransform | undefined, field: keyof FigGradientTransform, defaultValue: number): number {
  const v = t?.[field];
  return typeof v === "number" ? v : defaultValue;
}

// =============================================================================
// Linear gradient
// =============================================================================

/**
 * Compute SVG linear gradient endpoints from a Figma paint transform.
 *
 * Figma's gradient-space convention (derived by inverting actual Figma
 * exports — see spec for vertical and horizontal-squashed test vectors):
 *
 *   (grad_x, grad_y) = (m00·obj_x + m01·obj_y + m02,
 *                       m10·obj_x + m11·obj_y + m12)
 *
 * The transform maps object-space (0..1, 0..1) → gradient space. Linear
 * gradient stops sit on the grad_x axis only:
 *
 *   grad_x = 0  →  0% stop (first stop in paint.stops)
 *   grad_x = 1  →  100% stop (last stop in paint.stops)
 *
 * To emit a <linearGradient>, we need one object-space point on the
 * `grad_x = 0` line (→ x1, y1) and one on the `grad_x = 1` line (→ x2,
 * y2). The gradient-space origin (0, 0) and (1, 0) back-map through the
 * matrix's inverse to give these points.
 *
 * Verification (spec): a 90°-rotation paint produces a vertical
 * top→bottom gradient; an (identity-x, squashed-y) paint produces a
 * horizontal left→right gradient. Both match Figma's actual SVG output
 * direction.
 *
 * Returns `undefined` when the paint has no transform — callers use the
 * objectBoundingBox (0%..100%) form as the authoritative no-transform
 * behaviour, not as a recovery path for failed math.
 *
 * Throws on a non-invertible 2×2 upper block. A zero determinant means
 * `grad_x` does not depend on object position (grad_x is constant
 * across the whole element), so "0% stop line" vs "100% stop line" is
 * mathematically undefined — no direction we emit would be correct.
 * We refuse to invent one. Figma does not emit such matrices for valid
 * linear-gradient paints; callers receiving this error should treat the
 * paint as malformed rather than silently accept a wrong direction.
 */
export function linearGradientAttrs(
  transform: FigGradientTransform | undefined,
  elementBounds: ElementBounds,
): SvgLinearGradientAttrs | undefined {
  const t = transform;
  if (!t) { return undefined; }
  const bx = elementBounds.x;
  const by = elementBounds.y;
  const w = elementBounds.width;
  const h = elementBounds.height;

  const m00 = m(t, "m00", 1);
  const m01 = m(t, "m01", 0);
  const m02 = m(t, "m02", 0);
  const m10 = m(t, "m10", 0);
  const m11 = m(t, "m11", 1);
  const m12 = m(t, "m12", 0);

  // Linear gradients use the OPPOSITE matrix direction from radial:
  //
  // For linear, paint.transform maps OBJ-space → GRAD-space (1D parameter):
  //   grad_x = m00 * obj_x + m01 * obj_y + m02
  //
  // Stops live on the grad_x axis (grad_y is unused). To emit SVG endpoints
  // we need object-space points where `grad_x = 0` (stop-0%) and `grad_x = 1`
  // (stop-100%). These come from the inverse mapping.
  //
  // For radial, paint.transform maps GRAD-space → OBJ-space (the unit
  // circle becomes the gradient ellipse). The two conventions are opposites
  // because linear and radial parametrize gradient space differently —
  // verified against actual Figma exports for World map (vertical, 90°
  // rotation) and the (horizontal, identity-x) test vectors.
  //
  // The 2×2 upper block must be invertible (det ≠ 0). A zero determinant
  // means grad_x is constant across the element, making "0% line" vs "100%
  // line" undefined; we throw rather than emit a wrong direction.
  const det = m00 * m11 - m01 * m10;
  if (det === 0) {
    throw new Error(
      `linearGradientAttrs: non-invertible paint.transform (det=0). ` +
        `m=[[${m00}, ${m01}, ${m02}], [${m10}, ${m11}, ${m12}]]. ` +
        `Caller must treat this paint as malformed.`,
    );
  }

  // Inverse of the 2×2 upper block, applied to gradient-space points
  // (0, 0) and (1, 0) — translated by (-m02, -m12) first.
  //
  //   [obj_x]   1   [ m11  -m01] [grad_x - m02]
  //   [obj_y] = - · [-m10   m00] [grad_y - m12]
  //             d
  //
  // Where d = det = m00·m11 − m01·m10.
  //
  // grad-space (0, 0) → obj-space (a, b):
  //   a = (m11·(-m02) - m01·(-m12)) / d = (m01·m12 - m11·m02) / d
  //   b = (-m10·(-m02) + m00·(-m12)) / d = (m10·m02 - m00·m12) / d
  //
  // grad-space (1, 0) → obj-space (c, d_):
  //   c = (m11·(1 - m02) - m01·(-m12)) / d = (m11 - m11·m02 + m01·m12) / d
  //   d_ = (-m10·(1 - m02) + m00·(-m12)) / d = (-m10 + m10·m02 - m00·m12) / d
  const a = (m01 * m12 - m11 * m02) / det;
  const b = (m10 * m02 - m00 * m12) / det;
  const c = (m11 - m11 * m02 + m01 * m12) / det;
  const d_ = (-m10 + m10 * m02 - m00 * m12) / det;

  return {
    x1: bx + a * w,
    y1: by + b * h,
    x2: bx + c * w,
    y2: by + d_ * h,
    gradientUnits: "userSpaceOnUse",
  };
}

// =============================================================================
// Radial gradient
// =============================================================================

/**
 * Compute SVG gradientTransform for a radial gradient from a Figma paint
 * transform.
 *
 * Figma's radial gradient is defined on the unit circle centred at
 * `(0.5, 0.5)` with radius `0.5` in gradient space. Kiwi
 * `paint.transform` maps normalized object space → gradient space:
 *
 *   grad = A · object + b
 *
 * Therefore the SVG user-space ellipse must be built from the inverse:
 *
 *   centre = A^-1 · ([0.5, 0.5] - b)
 *   axis-x = A^-1 · [0.5, 0]
 *   axis-y = A^-1 · [0, 0.5]
 *
 * The SVG canonical radial gradient is `cx=0 cy=0 r=1`; the returned
 * matrix maps that unit circle onto the Figma ellipse. For perpendicular
 * axes we emit Figma's compact `translate(...) rotate(...) scale(...)`
 * spelling. For sheared radial gradients we emit the full affine
 * `matrix(a b c d e f)` so no axis information is discarded.
 *
 * Throws on a non-invertible matrix. A zero determinant means the
 * object→gradient transform collapses an axis, so the radial ellipse is
 * not recoverable from Kiwi data.
 */
export function radialGradientAttrs(
  transform: FigGradientTransform | undefined,
  elementBounds: ElementBounds,
): SvgRadialGradientAttrs | undefined {
  const t = transform;
  if (!t) { return undefined; }
  const bx = elementBounds.x;
  const by = elementBounds.y;
  const w = elementBounds.width;
  const h = elementBounds.height;

  const m00 = m(t, "m00", 1);
  const m01 = m(t, "m01", 0);
  const m02 = m(t, "m02", 0);
  const m10 = m(t, "m10", 0);
  const m11 = m(t, "m11", 1);
  const m12 = m(t, "m12", 0);

  const det = m00 * m11 - m01 * m10;
  if (det === 0) {
    throw new Error(
      `radialGradientAttrs: non-invertible paint.transform (det=0). ` +
        `m=[[${m00}, ${m01}, ${m02}], [${m10}, ${m11}, ${m12}]]. ` +
        `Caller must treat this paint as malformed.`,
    );
  }

  const inv00 = m11 / det;
  const inv01 = -m01 / det;
  const inv10 = -m10 / det;
  const inv11 = m00 / det;

  const centerObjX = inv00 * (0.5 - m02) + inv01 * (0.5 - m12);
  const centerObjY = inv10 * (0.5 - m02) + inv11 * (0.5 - m12);

  const matrix: SvgGradientMatrix = {
    a: inv00 * w * 0.5,
    b: inv10 * h * 0.5,
    c: inv01 * w * 0.5,
    d: inv11 * h * 0.5,
    e: bx + centerObjX * w,
    f: by + centerObjY * h,
  };

  return {
    cx: "0",
    cy: "0",
    r: "1",
    gradientUnits: "userSpaceOnUse",
    gradientTransform: formatRadialGradientMatrix(matrix),
  };
}

function formatRadialGradientMatrix(matrix: SvgGradientMatrix): string {
  const rx = Math.hypot(matrix.a, matrix.b);
  const ry = Math.hypot(matrix.c, matrix.d);
  if (rx > 0 && ry > 0) {
    const cos = matrix.a / rx;
    const sin = matrix.b / rx;
    const expectedC = -sin * ry;
    const expectedD = cos * ry;
    if (nearlyEqual(matrix.c, expectedC) && nearlyEqual(matrix.d, expectedD)) {
      const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      return `translate(${matrix.e} ${matrix.f}) rotate(${angle}) scale(${rx} ${ry})`;
    }
  }
  return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9;
}
