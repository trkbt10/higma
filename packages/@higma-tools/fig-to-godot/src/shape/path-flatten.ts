/**
 * @file Flatten Figma `PathCommand[]` (decoded from a `commandsBlob`)
 * into one or more closed polylines suitable for Godot's `Polygon2D`.
 *
 * Godot's `Polygon2D` accepts a flat `PackedVector2Array` of vertices
 * plus an optional `polygons` partition that names which contiguous
 * vertex slices form filled regions (multi-contour, even-odd / hole
 * handling).
 *
 * The flattener walks the SVG-style command stream and:
 *   - Treats `M` as the start of a new contour. Closes the previous
 *     contour implicitly (Figma never writes a stand-alone `Z`; it
 *     emits an explicit `L` back to the start, but we tolerate either).
 *   - Approximates `C` (cubic Bézier) and `Q` (quadratic Bézier) with
 *     adaptive subdivision until the chord/curve flatness is below
 *     `flatnessTolerance` (default 0.5px).
 *   - Drops zero-length segments.
 *   - Keeps each contour as its own `Contour` so callers can decide
 *     whether to emit them as separate `Polygon2D` nodes (one fill
 *     per contour) or as a single multi-contour Polygon2D with the
 *     `polygons` index partition (correct for donuts / even-odd fills).
 *
 * The flattener does NOT apply any transform — vertices come back in
 * the same coordinate space as the input commands (object-local).
 * Callers translate as needed.
 */
import { arcToCubicBeziers, type PathCommand } from "@higma-primitives/path";

/** A single closed polyline (one M ... [L|C|Q|...]* sequence).
 *
 * `partition` is an optional pre-computed triangulation hint: each
 * inner array is a list of indices into `points` forming one filled
 * region. The polygon emitter passes this through to Godot's
 * `Polygon2D.polygons` property when present, bypassing the GPU
 * triangulator's even-odd rule (which it doesn't run anyway). This
 * is how the synthesizer expresses ring shapes (donuts, full-circle
 * arc holes) — each ring quad is one region.
 */
export type Contour = {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly partition?: readonly (readonly number[])[];
  /**
   * When true, this contour is for stroke (outline) rendering only —
   * the fill path skips it. Used for donut / ring shapes where the
   * outer + inner ring outlines are tracked separately from the
   * merged-with-partition fill contour. Setting `outlineOnly` on a
   * contour without a sibling fill contour effectively makes the
   * shape stroke-only (no fill region).
   */
  readonly outlineOnly?: boolean;
};

/** Adaptive flatness tolerance (max chord-curve deviation in px). */
const DEFAULT_FLATNESS = 0.5;

/** Maximum recursion depth for the adaptive subdivider — guards against
 * pathological input that never converges on a chord-flat segment. */
const MAX_DEPTH = 16;

/**
 * Flatten an SVG-style command stream into one or more closed
 * polyline contours.
 *
 * Returns an empty array if the input has no `M` (no start point) or
 * produces only degenerate (zero-length) segments.
 */
export function flattenPathCommands(
  commands: readonly PathCommand[],
  flatness: number = DEFAULT_FLATNESS,
): readonly Contour[] {
  const contours: { readonly points: { x: number; y: number }[] }[] = [];
  const cursor = { x: 0, y: 0 };
  const start = { x: 0, y: 0 };
  const has_start = { value: false };

  function ensureContour(): { points: { x: number; y: number }[] } {
    if (contours.length === 0) {
      const fresh = { points: [] as { x: number; y: number }[] };
      contours.push(fresh);
      return fresh;
    }
    return contours[contours.length - 1];
  }

  function pushPoint(p: { x: number; y: number }, contour: { points: { x: number; y: number }[] }): void {
    const last = contour.points[contour.points.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) {
      return;
    }
    contour.points.push({ x: p.x, y: p.y });
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M": {
        // Start a new contour. If the previous contour is empty drop it.
        if (contours.length > 0 && contours[contours.length - 1].points.length === 0) {
          contours.pop();
        }
        const fresh = { points: [] as { x: number; y: number }[] };
        contours.push(fresh);
        cursor.x = cmd.x;
        cursor.y = cmd.y;
        start.x = cmd.x;
        start.y = cmd.y;
        has_start.value = true;
        pushPoint({ x: cmd.x, y: cmd.y }, fresh);
        break;
      }
      case "L": {
        if (!has_start.value) {
          break;
        }
        const contour = ensureContour();
        pushPoint({ x: cmd.x, y: cmd.y }, contour);
        cursor.x = cmd.x;
        cursor.y = cmd.y;
        break;
      }
      case "C": {
        if (!has_start.value) {
          break;
        }
        const contour = ensureContour();
        const points = subdivideCubic(
          { x: cursor.x, y: cursor.y },
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x2, y: cmd.y2 },
          { x: cmd.x, y: cmd.y },
          flatness,
          MAX_DEPTH,
        );
        for (const p of points) {
          pushPoint(p, contour);
        }
        cursor.x = cmd.x;
        cursor.y = cmd.y;
        break;
      }
      case "Q": {
        if (!has_start.value) {
          break;
        }
        const contour = ensureContour();
        const points = subdivideQuadratic(
          { x: cursor.x, y: cursor.y },
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x, y: cmd.y },
          flatness,
          MAX_DEPTH,
        );
        for (const p of points) {
          pushPoint(p, contour);
        }
        cursor.x = cmd.x;
        cursor.y = cmd.y;
        break;
      }
      case "A": {
        if (!has_start.value) {
          break;
        }
        const contour = ensureContour();
        // Decompose the arc into a sequence of cubic Bézier
        // segments via the primitive's W3C arc converter, then
        // flatten each cubic with the same adaptive subdivider.
        // godot's previous impl silently dropped `A` commands;
        // routing through the primitive picks them up correctly.
        const cubics = arcToCubicBeziers({
          x0: cursor.x, y0: cursor.y,
          rxIn: cmd.rx, ryIn: cmd.ry,
          rotationDeg: cmd.rotation,
          largeArc: cmd.largeArc, sweep: cmd.sweep,
          x: cmd.x, y: cmd.y,
        });
        for (const seg of cubics) {
          const points = subdivideCubic(
            { x: seg.x0, y: seg.y0 },
            { x: seg.x1, y: seg.y1 },
            { x: seg.x2, y: seg.y2 },
            { x: seg.x3, y: seg.y3 },
            flatness,
            MAX_DEPTH,
          );
          for (const p of points) {
            pushPoint(p, contour);
          }
        }
        cursor.x = cmd.x;
        cursor.y = cmd.y;
        break;
      }
      case "Z": {
        if (!has_start.value) {
          break;
        }
        const contour = ensureContour();
        // Figma's encoder usually closes by emitting an explicit `L`
        // back to start. Z just tells us to snap.
        pushPoint({ x: start.x, y: start.y }, contour);
        cursor.x = start.x;
        cursor.y = start.y;
        break;
      }
    }
  }

  // Drop empty / single-point contours — Polygon2D needs ≥3 vertices
  // to form a fillable region.
  return contours.filter((c) => c.points.length >= 3);
}

/**
 * Adaptive subdivision of a cubic Bézier. Returns the *non-start*
 * subdivision points (the start is already in the contour from the
 * previous segment's endpoint or `M`). Includes the curve endpoint as
 * the last entry so the contour stays continuous.
 */
function subdivideCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  flatness: number,
  depth: number,
): readonly { x: number; y: number }[] {
  if (depth <= 0 || isCubicFlat(p0, p1, p2, p3, flatness)) {
    return [p3];
  }
  const m = midpointsCubic(p0, p1, p2, p3);
  const left = subdivideCubic(p0, m.l1, m.l2, m.mid, flatness, depth - 1);
  const right = subdivideCubic(m.mid, m.r2, m.r1, p3, flatness, depth - 1);
  return [...left, ...right];
}

function midpointsCubic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): {
  readonly l1: { x: number; y: number };
  readonly l2: { x: number; y: number };
  readonly mid: { x: number; y: number };
  readonly r1: { x: number; y: number };
  readonly r2: { x: number; y: number };
} {
  const l1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const r1 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const l2 = { x: (l1.x + m.x) / 2, y: (l1.y + m.y) / 2 };
  const r2 = { x: (m.x + r1.x) / 2, y: (m.y + r1.y) / 2 };
  const mid = { x: (l2.x + r2.x) / 2, y: (l2.y + r2.y) / 2 };
  return { l1, l2, mid, r1, r2 };
}

/**
 * Flatness test for a cubic Bézier (Roger Willcocks' criterion):
 * sum of distances from each control point to the chord must be ≤
 * 16 × flatness². Cheap and conservative — over-subdivides slightly
 * but never under-subdivides.
 */
function isCubicFlat(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  flatness: number,
): boolean {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - 2 * p3.x - p0.x;
  const vy = 3 * p2.y - 2 * p3.y - p0.y;
  const ux2 = ux * ux;
  const uy2 = uy * uy;
  const vx2 = vx * vx;
  const vy2 = vy * vy;
  const max_x = ux2 > vx2 ? ux2 : vx2;
  const max_y = uy2 > vy2 ? uy2 : vy2;
  return max_x + max_y <= 16 * flatness * flatness;
}

/** Adaptive subdivision of a quadratic Bézier — same shape as cubic. */
function subdivideQuadratic(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  flatness: number,
  depth: number,
): readonly { x: number; y: number }[] {
  if (depth <= 0 || isQuadFlat(p0, p1, p2, flatness)) {
    return [p2];
  }
  const a = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const b = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const left = subdivideQuadratic(p0, a, m, flatness, depth - 1);
  const right = subdivideQuadratic(m, b, p2, flatness, depth - 1);
  return [...left, ...right];
}

/**
 * Quadratic flatness test: distance from the control point to the
 * chord midpoint must be ≤ flatness.
 */
function isQuadFlat(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  flatness: number,
): boolean {
  const dx = (p0.x + p2.x) / 2 - p1.x;
  const dy = (p0.y + p2.y) / 2 - p1.y;
  return dx * dx + dy * dy <= flatness * flatness;
}
