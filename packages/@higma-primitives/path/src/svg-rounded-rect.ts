/**
 * @file Rounded-rectangle SVG path-`d` builder — single SoT used by the
 * SVG / React / scene-graph render-tree pipelines.
 *
 * The same path-`d` string is consumed by:
 *   - the renderer's SVG scene-renderer (rect fill/stroke shapes)
 *   - render-tree clip-path shape construction
 *   - the React renderer's rect primitive component
 *
 * All consumers MUST produce the same path so that fill, stroke, and
 * clip align to the same sub-pixels. Using SVG `<rect rx>` or `A` arc
 * commands instead of cubic Bézier corners causes resvg-js to
 * rasterise the rounded corner one sub-pixel off from Figma's
 * exporter, producing a ~0.1% AA-only diff at large corner radii.
 *
 * Figma's SVG exporter emits the same Bézier-corner pattern with
 * KAPPA = 0.5522847498307936 (4·(√2−1)/3), so we use the constant
 * exported from `./contours/rect`.
 */

import { KAPPA } from "./contours";
import { clampCornerRadius } from "./corner-radius";

function cornerRadiusTuple(
  radii: readonly [number, number, number, number],
  width: number,
  height: number,
): readonly [number, number, number, number] {
  const clamped = clampCornerRadius(radii, width, height);
  if (clamped === undefined) {
    return [0, 0, 0, 0];
  }
  if (typeof clamped === "number") {
    return [clamped, clamped, clamped, clamped];
  }
  return clamped;
}

function maxSmoothingForEdge(length: number, a: number, b: number, insetHalf: number): number {
  const radiusSum = a + b;
  if (radiusSum <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (length + insetHalf * 2) / radiusSum - 1;
}

function clampSmoothingForRoundedRect(
  width: number,
  height: number,
  radii: readonly [number, number, number, number],
  smoothing: number,
  insetHalf: number,
): number {
  const [tl, tr, br, bl] = radii;
  const max = Math.min(
    smoothing,
    maxSmoothingForEdge(width, tl, tr, insetHalf),
    maxSmoothingForEdge(height, tr, br, insetHalf),
    maxSmoothingForEdge(width, bl, br, insetHalf),
    maxSmoothingForEdge(height, tl, bl, insetHalf),
  );
  if (max <= 0) {
    return 0;
  }
  return max;
}

/**
 * Build a rounded rect SVG path d string using cubic Bézier corners.
 *
 * Output verbatim shape (for tl=tr=br=bl=r, origin (X,Y), size (W,H)):
 *
 *   M X+r Y                  (top edge start)
 *   L X+W-r Y
 *   C ... X+W Y+r            (top-right corner)
 *   L X+W Y+H-r
 *   C ... X+W-r Y+H          (bottom-right corner)
 *   L X+r Y+H
 *   C ... X Y+H-r            (bottom-left corner)
 *   L X Y+r
 *   C ... X+r Y              (top-left corner)
 *   Z
 *
 * Origin defaults to (0, 0). A non-zero origin is used by clip-path
 * resolution when the clip is expanded outward by a stroke margin —
 * the expanded rect spans `(-margin, -margin) → (W+margin, H+margin)`.
 */
export function buildRoundedRectPathD(
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
  origin: { x: number; y: number } = { x: 0, y: 0 },
): string {
  const [tl, tr, br, bl] = cornerRadiusTuple(radii, w, h);
  const cTl = tl * (1 - KAPPA);
  const cTr = tr * (1 - KAPPA);
  const cBr = br * (1 - KAPPA);
  const cBl = bl * (1 - KAPPA);
  const x = origin.x;
  const y = origin.y;
  const parts = [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `C ${x + w - cTr} ${y} ${x + w} ${y + cTr} ${x + w} ${y + tr}` : "",
    `L ${x + w} ${y + h - br}`,
    br > 0 ? `C ${x + w} ${y + h - cBr} ${x + w - cBr} ${y + h} ${x + w - br} ${y + h}` : "",
    `L ${x + bl} ${y + h}`,
    bl > 0 ? `C ${x + cBl} ${y + h} ${x} ${y + h - cBl} ${x} ${y + h - bl}` : "",
    `L ${x} ${y + tl}`,
    tl > 0 ? `C ${x} ${y + cTl} ${x + cTl} ${y} ${x + tl} ${y}` : "",
    "Z",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Re-export under the legacy `CORNER_KAPPA` name for renderer callers. */
export const CORNER_KAPPA = KAPPA;

/**
 * Build an SVG path d string for a rectangle whose corners use Figma's
 * continuous-curvature ("Apple Squircle") smoothing rather than the
 * standard quarter-circle. The `smoothing` parameter (0..1) controls
 * how far each corner spreads onto the adjacent edges:
 *
 *   • smoothing = 0 → identical output to `buildRoundedRectPathD`
 *     (quarter-circle corner, edge consumption = r per corner).
 *   • smoothing = 0.6 → Apple's iOS-default smoothing (edge
 *     consumption = 1.6 r, with a 36° circular arc in the middle of
 *     each corner sandwiched between two cubic Bézier transitions).
 *   • smoothing = 1.0 → maximum smoothing (no central arc, two cubic
 *     Bézier halves meet on the corner bisector).
 *
 * Per-corner construction (top-left, going CCW from (0, p) to (p, 0)):
 *
 *   p                = (1 + smoothing) · r   // edge consumed by the corner
 *   arcMeasure (deg) = 90 · (1 − smoothing)  // angular span of the central arc
 *   alpha (deg)      = 45 · smoothing        // half of (90° − arcMeasure)
 *   p3ToP4Distance   = r · tan(alpha / 2)
 *   c                = p3ToP4Distance · cos(alpha)
 *   d                = c · tan(alpha)
 *   arcSection       = sin(arcMeasure / 2) · r · √2  (chord length)
 *   b                = (p − arcSection − c − d) / 3
 *   a                = 2 · b
 *
 *   M (0, p)
 *   C (0, p−a) (0, p−a−b) (d, p−a−b−c)              [smoothing in]
 *   C (cp1x, cp1y) (cp2x, cp2y) (p−a−b−c, d)         [arc as cubic]
 *   C (p−a−b, 0) (p−a, 0) (p, 0)                     [smoothing out]
 *
 * The arc-cubic control points use the standard cubic-Bézier-circular-
 * arc approximation: control offset = (4/3)·tan(arcMeasure/4)·r along
 * the tangent at each endpoint. The arc itself lies on the circle of
 * radius r centred at (r, r) for the top-left corner.
 *
 * When `smoothing === 0` this function returns the same byte pattern
 * as `buildRoundedRectPathD` — callers can route both paths through
 * the same code-path without branching.
 */
export function buildSmoothedRoundedRectPathD(
  w: number,
  h: number,
  radii: readonly [number, number, number, number],
  smoothing: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  /**
   * Optional aligned-stroke inset. When supplied, `radii` are
   * interpreted as the SOURCE cornerRadii (before inset) and the
   * smoothing extent / arc curvature are reconciled with Figma's
   * hybrid inset formula:
   *
   *   r_for_p   = R − insetHalf / (1 + s)     // controls smoothing extent p
   *   r_for_arc = R − insetHalf               // controls central arc curvature
   *
   * The two effective radii match Figma's SVG exporter for INSIDE-
   * aligned strokes on smoothed-corner rectangles. Calibration:
   * iPhone bezel "Aluminum" VECTOR (source R=76, s=0.6, sw=6) at
   * scale 0.2009 → theirs emits p=23.83 (= 14.892·1.6) with arc
   * chord 6.41 (= sin(18°)·14.665·√2). A naïve uniform inset
   * `R − insetHalf` applied to both p and arc yields p=23.46 and
   * mismatches by ~0.37 unit on the corner extent.
   *
   * `insetHalf > 0` insets inward (INSIDE-aligned stroke);
   * `insetHalf < 0` insets outward (OUTSIDE-aligned stroke).
   */
  insetHalf: number = 0,
): string {
  if (smoothing <= 0) {
    return buildRoundedRectPathD(w, h, radii, origin);
  }
  const clampedRadii = cornerRadiusTuple(radii, w, h);
  const effectiveSmoothing = clampSmoothingForRoundedRect(w, h, clampedRadii, smoothing, insetHalf);
  if (effectiveSmoothing <= 0) {
    return buildRoundedRectPathD(w, h, clampedRadii, origin);
  }
  const [tl, tr, br, bl] = clampedRadii;
  const x = origin.x;
  const y = origin.y;
  const tlParams = cornerParams(tl, effectiveSmoothing, insetHalf);
  const trParams = cornerParams(tr, effectiveSmoothing, insetHalf);
  const brParams = cornerParams(br, effectiveSmoothing, insetHalf);
  const blParams = cornerParams(bl, effectiveSmoothing, insetHalf);
  // Figma's SVG exporter splits the smoothing-in / smoothing-out
  // transitions of each corner into two sub-cubics (5 cubics per
  // corner) when emitting INSIDE/OUTSIDE-aligned strokes, but uses a
  // single cubic per transition (3 cubics per corner) when emitting
  // fills. Toggling on the inset-stroke codepath (`insetHalf !== 0`)
  // selects the 5-cubic decomposition so the rasterised AA matches
  // theirs's stroke byte pattern. Fills (insetHalf === 0) keep the
  // 3-cubic decomposition, which matches theirs's emission for cards
  // like Event Details Card (cs=0.6, no stroke).
  const subdivide = insetHalf !== 0;

  if (subdivide) {
    return buildSubdividedSmoothedRoundedRectPathD({
      w,
      h,
      origin,
      tl: tlParams,
      tr: trParams,
      br: brParams,
      bl: blParams,
    });
  }

  const parts: string[] = [];
  parts.push(`M ${x} ${y + tlParams.p}`);
  parts.push(...cornerCommandsTopLeft(x, y, tlParams, subdivide));
  parts.push(`L ${x + w - trParams.p} ${y}`);
  parts.push(...cornerCommandsTopRight(x + w, y, trParams, subdivide));
  parts.push(`L ${x + w} ${y + h - brParams.p}`);
  parts.push(...cornerCommandsBottomRight(x + w, y + h, brParams, subdivide));
  parts.push(`L ${x + blParams.p} ${y + h}`);
  parts.push(...cornerCommandsBottomLeft(x, y + h, blParams, subdivide));
  parts.push(`L ${x} ${y + tlParams.p}`);
  parts.push("Z");
  return parts.join(" ");
}

function buildSubdividedSmoothedRoundedRectPathD(
  params: {
    readonly w: number;
    readonly h: number;
    readonly origin: { readonly x: number; readonly y: number };
    readonly tl: CornerParams;
    readonly tr: CornerParams;
    readonly br: CornerParams;
    readonly bl: CornerParams;
  },
): string {
  const { w, h, origin, tl, tr, br, bl } = params;
  const x = origin.x;
  const y = origin.y;
  const parts: string[] = [];
  // Figma's SVG exporter emits aligned smoothed strokes from the top
  // edge. Keeping the same closed-path join location avoids backend
  // rasterizers placing the start/end join on a different curve.
  parts.push(`M ${x + tl.p} ${y}`);
  parts.push(`L ${x + w - tr.p} ${y}`);
  parts.push(...cornerCommandsTopRight(x + w, y, tr, true));
  parts.push(`L ${x + w} ${y + h - br.p}`);
  parts.push(...cornerCommandsBottomRight(x + w, y + h, br, true));
  parts.push(`L ${x + bl.p} ${y + h}`);
  parts.push(...cornerCommandsBottomLeft(x, y + h, bl, true));
  parts.push(`L ${x} ${y + tl.p}`);
  parts.push(...cornerCommandsTopLeft(x, y, tl, true));
  parts.push("Z");
  return parts.join(" ");
}

type CornerParams = {
  readonly r: number;
  readonly p: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  /** Arc-cubic control point offset along the tangent (4/3·tan(arcMeasure/4)·r). */
  readonly arcCpDist: number;
  /** sin(α), cos(α) where α = 45·smoothing — used for the arc-cubic tangents. */
  readonly sinA: number;
  readonly cosA: number;
};

/**
 * Compute corner parameters for the smoothed-corner emission. When
 * `insetHalf === 0` (the default fill / clip path case) both effective
 * radii are the input `r`. When `insetHalf > 0` (INSIDE-aligned
 * stroke) or `insetHalf < 0` (OUTSIDE-aligned), Figma uses two
 * separate inset reductions:
 *
 *   r_for_p   = r − insetHalf / (1 + smoothing)
 *   r_for_arc = r − insetHalf
 *
 * The smoothing extent `p = r_for_p · (1 + smoothing)` drives the
 * cubic-tangent geometry, and the arc-related quantities (arcSection,
 * c, d, arcCpDist) use `r_for_arc`. Calibration: theirs's Aluminum
 * top-right corner at source R=76, s=0.6, sw=6, scale=0.2009 emits
 * `p = 23.828` (matches `r_for_p · 1.6` with `r_for_p = 14.892`) and
 * an arc chord 6.41 (matches `sin(18°)·r_for_arc·√2` with
 * `r_for_arc = 14.665`).
 */
function cornerParams(r: number, smoothing: number, insetHalf: number = 0): CornerParams {
  if (r <= 0) {
    return { r: 0, p: 0, a: 0, b: 0, c: 0, d: 0, arcCpDist: 0, sinA: 0, cosA: 1 };
  }
  const rForP = insetHalf !== 0 ? r - insetHalf / (1 + smoothing) : r;
  const rForArc = insetHalf !== 0 ? r - insetHalf : r;
  if (rForP <= 0 || rForArc <= 0) {
    return { r: 0, p: 0, a: 0, b: 0, c: 0, d: 0, arcCpDist: 0, sinA: 0, cosA: 1 };
  }
  const p = (1 + smoothing) * rForP;
  const arcMeasureDeg = 90 * (1 - smoothing);
  const arcMeasureRad = (arcMeasureDeg * Math.PI) / 180;
  const arcSection = Math.sin(arcMeasureRad / 2) * rForArc * Math.SQRT2;
  const alphaDeg = 45 * smoothing;
  const alphaRad = (alphaDeg * Math.PI) / 180;
  const p3ToP4Distance = rForArc * Math.tan(alphaRad / 2);
  const c = p3ToP4Distance * Math.cos(alphaRad);
  const d = c * Math.tan(alphaRad);
  const b = (p - arcSection - c - d) / 3;
  const a = 2 * b;
  const arcCpDist = (4 / 3) * Math.tan(arcMeasureRad / 4) * rForArc;
  return {
    r: rForArc, p, a, b, c, d, arcCpDist,
    sinA: Math.sin(alphaRad),
    cosA: Math.cos(alphaRad),
  };
}

// Each corner is one quadrant of the smoothed-rect outline. Going CW
// around the rectangle the path enters and leaves each corner along a
// straight edge; the three cubic Béziers between the entry and exit
// points form the smoothing-in transition, the central arc (drawn as
// a cubic-Bézier circular-arc approximation), and the smoothing-out
// transition. The math is identical for every corner — only the sign
// of each axis and the direction of the tangent rotate by 90°. The
// helpers below all return the three "C …" commands that follow the
// connecting `L` line emitted by `buildSmoothedRoundedRectPathD`.

/**
 * De Casteljau subdivision of cubic (P0, C0, C1, P3) at parameter t.
 * Returns the two sub-cubics' control-point quadruples.
 *
 * Figma's SVG exporter splits each smoothing-in / smoothing-out
 * transition cubic into two sub-cubics so the corner is emitted as
 * 5 cubics rather than our 3-cubic default. The split point falls
 * empirically at `t ≈ 0.5` for `cornerSmoothing = 0.6` (per
 * calibration on AppStore Search Cell / App page screenshots iPhone
 * bezel `Aluminum` VECTORs). Without subdivision, rasterising the
 * same underlying curve via a single cubic vs two cubics produces
 * sub-pixel different AA at the corner due to how resvg flattens
 * Béziers to lines.
 */
function deCasteljauSplit(
  P0: readonly [number, number],
  C0: readonly [number, number],
  C1: readonly [number, number],
  P3: readonly [number, number],
  t: number,
): {
  readonly first: { readonly p0: readonly [number, number]; readonly c0: readonly [number, number]; readonly c1: readonly [number, number]; readonly p3: readonly [number, number] };
  readonly second: { readonly p0: readonly [number, number]; readonly c0: readonly [number, number]; readonly c1: readonly [number, number]; readonly p3: readonly [number, number] };
} {
  const lerp2 = (a: readonly [number, number], b: readonly [number, number], u: number): [number, number] =>
    [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const L0 = lerp2(P0, C0, t);
  const L1 = lerp2(C0, C1, t);
  const L2 = lerp2(C1, P3, t);
  const M0 = lerp2(L0, L1, t);
  const M1 = lerp2(L1, L2, t);
  const S = lerp2(M0, M1, t);
  return {
    first: { p0: P0, c0: L0, c1: M0, p3: S },
    second: { p0: S, c0: M1, c1: L2, p3: P3 },
  };
}

/**
 * Empirical De Casteljau split parameter for Figma's 5-cubic
 * smoothing-transition emission, measured as a fraction *from the
 * edge side* of each smoothing half. Calibration (re-derived
 * 2026-05-16 against the App Store template's iPhone Aluminum
 * bezels): at `cornerSmoothing = 0.6`, theirs's split point lands
 * at fraction `0.5057` from the edge in BOTH smoothing-in (top
 * edge → arc) and smoothing-out (arc → top edge), so the corner
 * is symmetric about its bisector.
 *
 * `SMOOTHING_SPLIT_FROM_EDGE = 0.5057` is the fraction from the
 * edge-side endpoint. Because `deCasteljauSplit(P0, …, P3, t)`
 * takes `t` measured from `P0`, the actual parameter passed in
 * depends on whether P0 is the edge or the arc side:
 *
 *   - Smoothing-IN cubic emits `P0 = edge`, `P3 = arc` →
 *     `t = SMOOTHING_SPLIT_FROM_EDGE`              (≈ 0.5057)
 *   - Smoothing-OUT cubic emits `P0 = arc`, `P3 = edge` →
 *     `t = 1 − SMOOTHING_SPLIT_FROM_EDGE`          (≈ 0.4943)
 *
 * De Casteljau subdivision is geometrically exact (the curve is
 * the same regardless of `t`) — these constants only control
 * WHERE on the curve we emit the sub-cubic breakpoint, which
 * matters for byte-matching theirs's path-d output and for the
 * sub-pixel AA at corner curves (resvg flattens long sub-cubics
 * slightly differently from short ones).
 */
const SMOOTHING_T_IN = 0.5057;
const SMOOTHING_T_OUT = 1 - SMOOTHING_T_IN;

function cornerCommandsTopLeft(x: number, y: number, c: CornerParams, subdivide: boolean = false): readonly string[] {
  // Corner vertex at (x, y). Path entry: (x, y + p); exit: (x + p, y).
  const m1 = c.p - c.a;
  const m2 = c.p - c.a - c.b;
  const m3 = c.p - c.a - c.b - c.c;
  const arcStartX = x + c.d, arcStartY = y + m3;
  const arcEndX = x + m3, arcEndY = y + c.d;
  // Tangent at arc start (heading from left edge toward top edge, CW
  // around the rectangle): (sin α, −cos α). Tangent at arc end
  // (approaching the top edge): (cos α, −sin α).
  const cp1x = arcStartX + c.arcCpDist * c.sinA;
  const cp1y = arcStartY - c.arcCpDist * c.cosA;
  const cp2x = arcEndX - c.arcCpDist * c.cosA;
  const cp2y = arcEndY + c.arcCpDist * c.sinA;
  const cubicArc = `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${arcEndX} ${arcEndY}`;
  if (!subdivide) {
    const cubic1 = `C ${x} ${y + m1} ${x} ${y + m2} ${x + c.d} ${y + m3}`;
    const cubic3 = `C ${x + m2} ${y} ${x + m1} ${y} ${x + c.p} ${y}`;
    return [cubic1, cubicArc, cubic3];
  }
  // Smoothing-in cubic from (x, y+p) to (x+d, y+m3), subdivided.
  const inSplit = deCasteljauSplit([x, y + c.p], [x, y + m1], [x, y + m2], [x + c.d, y + m3], SMOOTHING_T_IN);
  const cubic1a = `C ${inSplit.first.c0[0]} ${inSplit.first.c0[1]} ${inSplit.first.c1[0]} ${inSplit.first.c1[1]} ${inSplit.first.p3[0]} ${inSplit.first.p3[1]}`;
  const cubic1b = `C ${inSplit.second.c0[0]} ${inSplit.second.c0[1]} ${inSplit.second.c1[0]} ${inSplit.second.c1[1]} ${inSplit.second.p3[0]} ${inSplit.second.p3[1]}`;
  // Smoothing-out cubic from (x+m3, y+d) to (x+p, y), subdivided.
  const outSplit = deCasteljauSplit([x + m3, y + c.d], [x + m2, y], [x + m1, y], [x + c.p, y], SMOOTHING_T_OUT);
  const cubic3a = `C ${outSplit.first.c0[0]} ${outSplit.first.c0[1]} ${outSplit.first.c1[0]} ${outSplit.first.c1[1]} ${outSplit.first.p3[0]} ${outSplit.first.p3[1]}`;
  const cubic3b = `C ${outSplit.second.c0[0]} ${outSplit.second.c0[1]} ${outSplit.second.c1[0]} ${outSplit.second.c1[1]} ${outSplit.second.p3[0]} ${outSplit.second.p3[1]}`;
  return [cubic1a, cubic1b, cubicArc, cubic3a, cubic3b];
}

function cornerCommandsTopRight(x: number, y: number, c: CornerParams, subdivide: boolean = false): readonly string[] {
  // Corner vertex at (x, y). Path entry: (x − p, y); exit: (x, y + p).
  const m1 = c.p - c.a;
  const m2 = c.p - c.a - c.b;
  const m3 = c.p - c.a - c.b - c.c;
  const arcStartX = x - m3, arcStartY = y + c.d;
  const arcEndX = x - c.d, arcEndY = y + m3;
  // CW-around-rect tangents for the TR quadrant: (cos α, sin α) at
  // start, (sin α, cos α) at end.
  const cp1x = arcStartX + c.arcCpDist * c.cosA;
  const cp1y = arcStartY + c.arcCpDist * c.sinA;
  const cp2x = arcEndX - c.arcCpDist * c.sinA;
  const cp2y = arcEndY - c.arcCpDist * c.cosA;
  const cubicArc = `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${arcEndX} ${arcEndY}`;
  if (!subdivide) {
    const cubic1 = `C ${x - m1} ${y} ${x - m2} ${y} ${x - m3} ${y + c.d}`;
    const cubic3 = `C ${x} ${y + m2} ${x} ${y + m1} ${x} ${y + c.p}`;
    return [cubic1, cubicArc, cubic3];
  }
  const inSplit = deCasteljauSplit([x - c.p, y], [x - m1, y], [x - m2, y], [x - m3, y + c.d], SMOOTHING_T_IN);
  const cubic1a = `C ${inSplit.first.c0[0]} ${inSplit.first.c0[1]} ${inSplit.first.c1[0]} ${inSplit.first.c1[1]} ${inSplit.first.p3[0]} ${inSplit.first.p3[1]}`;
  const cubic1b = `C ${inSplit.second.c0[0]} ${inSplit.second.c0[1]} ${inSplit.second.c1[0]} ${inSplit.second.c1[1]} ${inSplit.second.p3[0]} ${inSplit.second.p3[1]}`;
  const outSplit = deCasteljauSplit([x - c.d, y + m3], [x, y + m2], [x, y + m1], [x, y + c.p], SMOOTHING_T_OUT);
  const cubic3a = `C ${outSplit.first.c0[0]} ${outSplit.first.c0[1]} ${outSplit.first.c1[0]} ${outSplit.first.c1[1]} ${outSplit.first.p3[0]} ${outSplit.first.p3[1]}`;
  const cubic3b = `C ${outSplit.second.c0[0]} ${outSplit.second.c0[1]} ${outSplit.second.c1[0]} ${outSplit.second.c1[1]} ${outSplit.second.p3[0]} ${outSplit.second.p3[1]}`;
  return [cubic1a, cubic1b, cubicArc, cubic3a, cubic3b];
}

function cornerCommandsBottomRight(x: number, y: number, c: CornerParams, subdivide: boolean = false): readonly string[] {
  // Corner vertex at (x, y). Path entry: (x, y − p); exit: (x − p, y).
  const m1 = c.p - c.a;
  const m2 = c.p - c.a - c.b;
  const m3 = c.p - c.a - c.b - c.c;
  const arcStartX = x - c.d, arcStartY = y - m3;
  const arcEndX = x - m3, arcEndY = y - c.d;
  const cp1x = arcStartX - c.arcCpDist * c.sinA;
  const cp1y = arcStartY + c.arcCpDist * c.cosA;
  const cp2x = arcEndX + c.arcCpDist * c.cosA;
  const cp2y = arcEndY - c.arcCpDist * c.sinA;
  const cubicArc = `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${arcEndX} ${arcEndY}`;
  if (!subdivide) {
    const cubic1 = `C ${x} ${y - m1} ${x} ${y - m2} ${x - c.d} ${y - m3}`;
    const cubic3 = `C ${x - m2} ${y} ${x - m1} ${y} ${x - c.p} ${y}`;
    return [cubic1, cubicArc, cubic3];
  }
  const inSplit = deCasteljauSplit([x, y - c.p], [x, y - m1], [x, y - m2], [x - c.d, y - m3], SMOOTHING_T_IN);
  const cubic1a = `C ${inSplit.first.c0[0]} ${inSplit.first.c0[1]} ${inSplit.first.c1[0]} ${inSplit.first.c1[1]} ${inSplit.first.p3[0]} ${inSplit.first.p3[1]}`;
  const cubic1b = `C ${inSplit.second.c0[0]} ${inSplit.second.c0[1]} ${inSplit.second.c1[0]} ${inSplit.second.c1[1]} ${inSplit.second.p3[0]} ${inSplit.second.p3[1]}`;
  const outSplit = deCasteljauSplit([x - m3, y - c.d], [x - m2, y], [x - m1, y], [x - c.p, y], SMOOTHING_T_OUT);
  const cubic3a = `C ${outSplit.first.c0[0]} ${outSplit.first.c0[1]} ${outSplit.first.c1[0]} ${outSplit.first.c1[1]} ${outSplit.first.p3[0]} ${outSplit.first.p3[1]}`;
  const cubic3b = `C ${outSplit.second.c0[0]} ${outSplit.second.c0[1]} ${outSplit.second.c1[0]} ${outSplit.second.c1[1]} ${outSplit.second.p3[0]} ${outSplit.second.p3[1]}`;
  return [cubic1a, cubic1b, cubicArc, cubic3a, cubic3b];
}

function cornerCommandsBottomLeft(x: number, y: number, c: CornerParams, subdivide: boolean = false): readonly string[] {
  // Corner vertex at (x, y). Path entry: (x + p, y); exit: (x, y − p).
  const m1 = c.p - c.a;
  const m2 = c.p - c.a - c.b;
  const m3 = c.p - c.a - c.b - c.c;
  const arcStartX = x + m3, arcStartY = y - c.d;
  const arcEndX = x + c.d, arcEndY = y - m3;
  const cp1x = arcStartX - c.arcCpDist * c.cosA;
  const cp1y = arcStartY - c.arcCpDist * c.sinA;
  const cp2x = arcEndX + c.arcCpDist * c.sinA;
  const cp2y = arcEndY + c.arcCpDist * c.cosA;
  const cubicArc = `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${arcEndX} ${arcEndY}`;
  if (!subdivide) {
    const cubic1 = `C ${x + m1} ${y} ${x + m2} ${y} ${x + m3} ${y - c.d}`;
    const cubic3 = `C ${x} ${y - m2} ${x} ${y - m1} ${x} ${y - c.p}`;
    return [cubic1, cubicArc, cubic3];
  }
  const inSplit = deCasteljauSplit([x + c.p, y], [x + m1, y], [x + m2, y], [x + m3, y - c.d], SMOOTHING_T_IN);
  const cubic1a = `C ${inSplit.first.c0[0]} ${inSplit.first.c0[1]} ${inSplit.first.c1[0]} ${inSplit.first.c1[1]} ${inSplit.first.p3[0]} ${inSplit.first.p3[1]}`;
  const cubic1b = `C ${inSplit.second.c0[0]} ${inSplit.second.c0[1]} ${inSplit.second.c1[0]} ${inSplit.second.c1[1]} ${inSplit.second.p3[0]} ${inSplit.second.p3[1]}`;
  const outSplit = deCasteljauSplit([x + c.d, y - m3], [x, y - m2], [x, y - m1], [x, y - c.p], SMOOTHING_T_OUT);
  const cubic3a = `C ${outSplit.first.c0[0]} ${outSplit.first.c0[1]} ${outSplit.first.c1[0]} ${outSplit.first.c1[1]} ${outSplit.first.p3[0]} ${outSplit.first.p3[1]}`;
  const cubic3b = `C ${outSplit.second.c0[0]} ${outSplit.second.c0[1]} ${outSplit.second.c1[0]} ${outSplit.second.c1[1]} ${outSplit.second.p3[0]} ${outSplit.second.p3[1]}`;
  return [cubic1a, cubic1b, cubicArc, cubic3a, cubic3b];
}
