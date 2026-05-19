/**
 * @file Translate Figma gradient paints to SwiftUI gradient expressions.
 *
 * SwiftUI exposes a small family of gradient shapes — `LinearGradient`,
 * `RadialGradient`, `AngularGradient` — each with a stop list and a
 * pair of unit-space (0..1) anchor points.
 *
 * Figma's Kiwi `paint.transform` maps **object space → gradient
 * space**, the inverse of what one might guess from the field's name.
 * The gradient-space convention is that the 0% stop sits at (0, 0)
 * and the 100% stop sits at (1, 0). To recover the SwiftUI startPoint
 * and endPoint (in *object* unit-space) we invert the 2×2 upper block
 * of the matrix and back-map gradient (0,0) and (1,0) into object
 * space.
 *
 * `@higma-document-renderers/fig/paint` owns the canonical
 * interpretation; this emitter only formats those resolved values as
 * SwiftUI expressions.
 *
 * For `RadialGradient` the same convention applies: the centre is at
 * the inverse-mapped (0, 0). The radius equals 1 unit of gradient-x
 * back-projected, which is the magnitude of the inverse matrix's
 * first column.
 *
 */
import type {
  FigGradientPaint,
  FigGradientStop,
  FigPaint,
} from "@higma-document-models/fig/types";
import { asGradientPaint, getPaintType } from "@higma-document-models/fig/color";
import {
  getAngularGradientParams,
  getGradientDirection,
  getGradientStops,
  getRadialGradientCenterAndRadius,
} from "@higma-document-renderers/fig/paint";
import {
  call,
  member,
  namedArg,
  num,
  type SwiftCallArg,
  type SwiftExpr,
} from "../swift-tree";
import { colorExpr } from "./color";

/**
 * Pick the first visible gradient paint in a stack. Returns undefined
 * when no gradient is present — the caller falls back to the SOLID
 * path.
 */
export function firstVisibleGradientPaint(
  paints: readonly FigPaint[] | undefined,
): FigGradientPaint | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    const gradientPaint = asGradientPaint(paint);
    if (gradientPaint !== undefined) {
      return gradientPaint;
    }
  }
  return undefined;
}

/**
 * Build a SwiftUI gradient expression for a `FigGradientPaint`. The
 * caller decides whether to wrap the result in `.fill(...)` (shape leaf)
 * or `.background(...)` (container).
 *
 * `elementSize` is the size of the view that the gradient paints onto,
 * in points. SwiftUI projects gradient endpoints in pixel space (each
 * UnitPoint coordinate is multiplied by the view's width/height), while
 * the WebGL reference renderer projects in normalized unit space — for
 * a non-square view those produce different isolines. The routine
 * compensates by scaling the SwiftUI endpoints anisotropically so
 * SwiftUI's pixel-space projection of any unit-point gives the same t
 * value as the WebGL unit-space projection. Passing `undefined` skips
 * the compensation and uses the raw object-normalized endpoints — only
 * appropriate when the view is square or the gradient axis is aligned
 * with x or y (so the projection metric is irrelevant).
 */
export function gradientExpr(
  paint: FigGradientPaint,
  elementSize: { readonly width: number; readonly height: number } | undefined,
): SwiftExpr {
  const stopsArg = swiftGradientStopListArg(resolveStops(paint), paint.opacity ?? 1);
  switch (getPaintType(paint)) {
    case "GRADIENT_LINEAR":
      return linearGradientExpr(paint, stopsArg, elementSize);
    case "GRADIENT_RADIAL":
      return radialGradientExpr(paint, stopsArg, elementSize);
    case "GRADIENT_ANGULAR":
      return angularGradientExpr(paint, stopsArg);
    case "GRADIENT_DIAMOND":
      // SwiftUI has no native diamond-gradient (square-distance
      // gradient). The closest visual approximation is a
      // RadialGradient — concentric squares vs. concentric circles
      // are visually similar at the centre and disagree at the
      // corners. The diff against Figma's diamond renderer absorbs
      // that mismatch.
      return radialGradientExpr(paint, stopsArg, elementSize);
    default:
      throw new Error("gradientExpr requires a gradient paint");
  }
}

function resolveStops(paint: FigGradientPaint): readonly FigGradientStop[] {
  return getGradientStops(paint);
}

function swiftGradientStopListArg(
  stops: readonly FigGradientStop[],
  paintOpacity: number,
): SwiftCallArg {
  const elements: SwiftExpr[] = stops.map((s) =>
    call("Gradient.Stop", [
      namedArg("color", colorExpr(s.color, paintOpacity)),
      namedArg("location", num(s.position)),
    ]),
  );
  return namedArg("stops", { kind: "array", elements });
}

function linearGradientExpr(
  paint: FigGradientPaint,
  stopsArg: SwiftCallArg,
  elementSize: { readonly width: number; readonly height: number } | undefined,
): SwiftExpr {
  const direction = getGradientDirection(paint);
  const compensated = compensateForPixelSpace(direction.start, direction.end, elementSize);
  return call("LinearGradient", [
    stopsArg,
    namedArg("startPoint", unitPointExpr(compensated.start.x, compensated.start.y)),
    namedArg("endPoint", unitPointExpr(compensated.end.x, compensated.end.y)),
  ]);
}

/**
 * Build an `AngularGradient(stops:, center:, angle:)` for a Figma
 * GRADIENT_ANGULAR paint. Figma's angular gradient is centred at
 * the *object's* `(0.5, 0.5)` (the renderer treats `paint.transform`
 * as encoding only the rotation; the centre is fixed). The start
 * angle is `atan2(-m10, m00) + 90°` measured CW from 12 o'clock, to
 * match the conic-gradient CSS convention.
 *
 * SwiftUI's `AngularGradient` defaults its zero-angle direction to
 * 3 o'clock (right) and sweeps CW. To match Figma's "start at top"
 * convention we offset by -90° so a Figma angle of 0° lands at
 * 12 o'clock in SwiftUI.
 */
function angularGradientExpr(paint: FigGradientPaint, stopsArg: SwiftCallArg): SwiftExpr {
  const params = getAngularGradientParams(paint);
  // The WebGL reference renderer projects the angular gradient via
  //   angle = atan2(dy, dx) − u_rotation
  //   t     = mod(angle / 2π + 1, 1)
  // with `u_rotation = atan2(-m10, m00) + π/2` (radians) and `delta =
  // localPos − center` measured in screen-y-down coords. For an
  // identity-rotated paint (`m00=1, m10=0`) `u_rotation = π/2`, which
  // — solving for `t = 0` — puts the 0% stop at 6 o'clock (verified
  // empirically against the WebGL reference for `angular-circle`:
  // red bottom, green left, blue right).
  //
  // SwiftUI's `AngularGradient(angle:)` measures `angle` CW from
  // 3 o'clock (the +x axis); the gradient sweeps CW from there. To
  // place the 0% stop at 6 o'clock we therefore pass +90°. In the
  // general case `angle = atan2(-m10, m00) + 90°` lands the 0% stop
  // at the same screen position as the WebGL reference.
  //
  // (A previous attempt subtracted 90° on the assumption that Figma's
  // start sat at 12 o'clock; that assumption was wrong — the WebGL
  // shader's screen-y-down `atan2(dy, dx)` resolves to +π/2 at the
  // bottom, not the top.)
  return call("AngularGradient", [
    stopsArg,
    namedArg("center", unitPointExpr(params.center.x, params.center.y)),
    namedArg("angle", call(".degrees", [{ value: num(roundDegrees(params.startAngle)) }])),
  ]);
}

function roundDegrees(deg: number): number {
  if (Math.abs(deg - Math.round(deg)) < 1e-3) {
    return Math.round(deg);
  }
  return Math.round(deg * 1000) / 1000;
}

/**
 * Build an `EllipticalGradient(stops:, center:, startRadiusFraction:,
 * endRadiusFraction:)` expression for non-square elements where the
 * radial gradient should stretch with the element's aspect ratio.
 * SwiftUI's `EllipticalGradient` measures both radii as fractions
 * of the element's size — endRadiusFraction=1 fills the whole
 * element with the gradient extending to the corners.
 */
function ellipticalGradientExpr(paint: FigGradientPaint, stopsArg: SwiftCallArg): SwiftExpr {
  const params = getRadialGradientCenterAndRadius(paint);
  const center = unitPointExpr(params.center.x, params.center.y);
  return call("EllipticalGradient", [
    stopsArg,
    namedArg("center", center),
    namedArg("startRadiusFraction", num(0)),
    namedArg("endRadiusFraction", num(params.radius)),
  ]);
}

function radialGradientExpr(
  paint: FigGradientPaint,
  stopsArg: SwiftCallArg,
  elementSize: { readonly width: number; readonly height: number } | undefined,
): SwiftExpr {
  // For non-square elements use SwiftUI's `EllipticalGradient` so
  // the gradient stretches to match the element's aspect ratio,
  // matching Figma's WebGL radial-gradient shader which projects
  // via `(localPos - center) / (radiusX, radiusY)`. SwiftUI's
  // `EllipticalGradient` is iOS 15+ / macOS 12+; the v0 emitter
  // targets at least that floor.
  if (elementSize && elementSize.width !== elementSize.height) {
    return ellipticalGradientExpr(paint, stopsArg);
  }
  // Figma's radial-gradient convention:
  //   center = (m02, m12) in object-normalized space (NOT the
  //            inverse map — radial transforms encode the centre
  //            and radius directly, unlike linear gradients which
  //            encode the gradient axis as an object→gradient map)
  //   radius = m00 (uniform; m11 is conventionally the same as m00
  //            for circular gradients, or different for elliptical)
  // SwiftUI's RadialGradient projects in pixel space; we still need
  // to compensate for non-square elements by scaling the radius.
  const params = getRadialGradientCenterAndRadius(paint);
  const center = unitPointExpr(params.center.x, params.center.y);
  const startRadius = num(0);
  // Figma's WebGL radial-gradient shader stretches the gradient
  // ellipsoidally to match the element's aspect ratio:
  //   t = length((localPos - center) / vec2(radiusX, radiusY))
  // SwiftUI's `RadialGradient` is strictly circular. The closest
  // visual match is to set the radius to the LONGER axis so the
  // gradient covers the full extent (a circular gradient on the
  // shorter axis would leave the corners uncovered). For square
  // elements both choices coincide; for elongated pills /
  // landscape rectangles, this minimises the diff.
  const longerDim = elementSize ? Math.max(elementSize.width, elementSize.height) : 1;
  const radius = params.radius * longerDim;
  const endRadius = num(radius);
  return call("RadialGradient", [
    stopsArg,
    namedArg("center", center),
    namedArg("startRadius", startRadius),
    namedArg("endRadius", endRadius),
  ]);
}

/**
 * Adjust a unit-space gradient axis so that SwiftUI's pixel-space
 * projection of any unit-point produces the same `t` along the axis as
 * the WebGL reference renderer's unit-space projection.
 *
 * SwiftUI computes `t = ((P_pixel - start_pixel) · v_pixel) / |v_pixel|²`
 * where pixel coords are `(unit.x · w, unit.y · h)`. The WebGL renderer
 * computes `t = ((P_unit - start_unit) · v_unit) / |v_unit|²` directly
 * in unit space. For a square view (w = h) the two are equal up to
 * an aspect ratio that cancels out; for a non-square view they
 * disagree by the aspect ratio of `(w, h)` weighted into the dot
 * product.
 *
 * The fix: keep `start` in unit space and choose a new `end' = start +
 * (D.x · α/w², D.y · α/h²)` where α is picked so the SwiftUI
 * projection matches the WebGL projection at every point. The
 * algebra is detailed in the routine's comment block.
 *
 * Skips compensation when `elementSize` is undefined or describes a
 * square view (no projection mismatch).
 */
function compensateForPixelSpace(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  elementSize: { readonly width: number; readonly height: number } | undefined,
): {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
} {
  if (!elementSize) {
    return { start, end };
  }
  const { width: w, height: h } = elementSize;
  if (w === h || w <= 0 || h <= 0) {
    return { start, end };
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dLenSq = dx * dx + dy * dy;
  if (dLenSq === 0) {
    return { start, end };
  }
  // α = |D|² / (D.x²/w² + D.y²/h²), λ for SwiftUI's pixel-space metric
  // to project to the same fractions as WebGL's unit-space metric.
  const denom = (dx * dx) / (w * w) + (dy * dy) / (h * h);
  if (denom === 0) {
    return { start, end };
  }
  const alpha = dLenSq / denom;
  // end_s.{x,y} - start_s.{x,y} = D.{x,y} · α / {w,h}²
  const newDx = (dx * alpha) / (w * w);
  const newDy = (dy * alpha) / (h * h);
  return {
    start,
    end: { x: start.x + newDx, y: start.y + newDy },
  };
}

function unitPointExpr(x: number, y: number): SwiftExpr {
  // Snap "well-known" Figma anchor points (.topLeading, .top,
  // .bottomTrailing …) to SwiftUI's named UnitPoint members so the
  // emitted source reads idiomatically when the gradient runs along a
  // canonical axis.
  const named = matchNamedUnitPoint(x, y);
  if (named) {
    return member(named);
  }
  return call("UnitPoint", [
    namedArg("x", num(roundUnit(x))),
    namedArg("y", num(roundUnit(y))),
  ]);
}

function matchNamedUnitPoint(x: number, y: number): string | undefined {
  if (close(x, 0.5) && close(y, 0)) {
    return "top";
  }
  if (close(x, 0.5) && close(y, 1)) {
    return "bottom";
  }
  if (close(x, 0) && close(y, 0.5)) {
    return "leading";
  }
  if (close(x, 1) && close(y, 0.5)) {
    return "trailing";
  }
  if (close(x, 0) && close(y, 0)) {
    return "topLeading";
  }
  if (close(x, 1) && close(y, 0)) {
    return "topTrailing";
  }
  if (close(x, 0) && close(y, 1)) {
    return "bottomLeading";
  }
  if (close(x, 1) && close(y, 1)) {
    return "bottomTrailing";
  }
  if (close(x, 0.5) && close(y, 0.5)) {
    return "center";
  }
  return undefined;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-3;
}

function roundUnit(v: number): number {
  return Math.round(v * 1000) / 1000;
}
