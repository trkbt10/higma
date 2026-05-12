/**
 * @file Adaptive Bézier flattening for path command streams.
 *
 * Turns a `PathCommand[]` into a flat coordinate array
 * `[x0, y0, x1, y1, …]` suitable for triangulators and other consumers
 * that need a polyline representation. Curves are split via De
 * Casteljau subdivision under a flatness predicate; arcs are first
 * converted to cubics through `arcToCubicBeziers`.
 */

import { arcToCubicBeziers } from "./arc";
import type { PathCommand } from "./types";

/**
 * 20 subdivisions reduces the chord/curve deviation by 2²⁰ ≈ 10⁶,
 * which is below one pixel for any path that fits in a typical
 * viewport. Without this cap a degenerate cubic (e.g. `x0===x3` and
 * `y0===y3` with non-collinear controls — a closed loop) recurses
 * indefinitely because the flatness measure stays positive forever.
 */
const BEZIER_MAX_DEPTH = 20;

type CubicBezierParams = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  tolerance: number;
  points: number[];
  /**
   * Recursion budget. Callers must pass an explicit value because
   * degenerate inputs (start === end with non-collinear controls,
   * common in mask-icon path data) make the flatness predicate never
   * converge, and an unbounded recursion overflows the stack.
   */
  depth: number;
};

/**
 * Flatten a cubic Bézier curve into line segments via De Casteljau
 * subdivision with adaptive tolerance and a hard recursion cap.
 *
 * Internal helper exported because the arc flattener composes it on
 * each arc segment.
 */
export function flattenCubicBezier(params: CubicBezierParams): void {
  const { x0, y0, x1, y1, x2, y2, x3, y3, tolerance, points, depth } = params;
  const dx = x3 - x0;
  const dy = y3 - y0;
  const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx);
  const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  const dd = d1 + d2;

  if (dd * dd < tolerance * (dx * dx + dy * dy) || depth <= 0) {
    points.push(x3, y3);
    return;
  }

  const x01 = (x0 + x1) * 0.5;
  const y01 = (y0 + y1) * 0.5;
  const x12 = (x1 + x2) * 0.5;
  const y12 = (y1 + y2) * 0.5;
  const x23 = (x2 + x3) * 0.5;
  const y23 = (y2 + y3) * 0.5;
  const x012 = (x01 + x12) * 0.5;
  const y012 = (y01 + y12) * 0.5;
  const x123 = (x12 + x23) * 0.5;
  const y123 = (y12 + y23) * 0.5;
  const x0123 = (x012 + x123) * 0.5;
  const y0123 = (y012 + y123) * 0.5;

  flattenCubicBezier({ x0, y0, x1: x01, y1: y01, x2: x012, y2: y012, x3: x0123, y3: y0123, tolerance, points, depth: depth - 1 });
  flattenCubicBezier({ x0: x0123, y0: y0123, x1: x123, y1: y123, x2: x23, y2: y23, x3, y3, tolerance, points, depth: depth - 1 });
}

type QuadBezierParams = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tolerance: number;
  points: number[];
};

/**
 * Flatten a quadratic Bézier by elevating to a cubic and reusing the
 * cubic flattener. Q→C elevation:
 *   cp1 = P0 + 2/3 · (Q − P0)
 *   cp2 = P2 + 2/3 · (Q − P2)
 */
export function flattenQuadBezier(params: QuadBezierParams): void {
  const { x0, y0, x1, y1, x2, y2, tolerance, points } = params;
  const cx1 = x0 + (2 / 3) * (x1 - x0);
  const cy1 = y0 + (2 / 3) * (y1 - y0);
  const cx2 = x2 + (2 / 3) * (x1 - x2);
  const cy2 = y2 + (2 / 3) * (y1 - y2);
  flattenCubicBezier({
    x0, y0,
    x1: cx1, y1: cy1,
    x2: cx2, y2: cy2,
    x3: x2, y3: y2,
    tolerance,
    points,
    depth: BEZIER_MAX_DEPTH,
  });
}

/**
 * Flatten path commands into a polyline (`[x0, y0, x1, y1, …]`).
 *
 * Arcs are first converted to cubics through `arcToCubicBeziers` then
 * subdivided with the cubic flattener — every command kind reduces to
 * a sequence of straight segments anchored on endpoints.
 *
 * `Z` snaps back to the subpath start and emits the start coordinate
 * when the current cursor doesn't already sit on it (matching SVG's
 * "closepath ⇒ implicit lineto to start" semantics).
 */
export function flattenPathCommands(
  commands: readonly PathCommand[],
  tolerance: number = 0.25,
): number[] {
  const points: number[] = [];
  const currentXRef = { value: 0 };
  const currentYRef = { value: 0 };
  const startXRef = { value: 0 };
  const startYRef = { value: 0 };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        startXRef.value = currentXRef.value;
        startYRef.value = currentYRef.value;
        points.push(currentXRef.value, currentYRef.value);
        break;

      case "L":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        points.push(currentXRef.value, currentYRef.value);
        break;

      case "C":
        flattenCubicBezier({
          x0: currentXRef.value,
          y0: currentYRef.value,
          x1: cmd.x1,
          y1: cmd.y1,
          x2: cmd.x2,
          y2: cmd.y2,
          x3: cmd.x,
          y3: cmd.y,
          tolerance,
          points,
          depth: BEZIER_MAX_DEPTH,
        });
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        break;

      case "Q":
        flattenQuadBezier({
          x0: currentXRef.value,
          y0: currentYRef.value,
          x1: cmd.x1,
          y1: cmd.y1,
          x2: cmd.x,
          y2: cmd.y,
          tolerance,
          points,
        });
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        break;

      case "A": {
        const arcCubics = arcToCubicBeziers({
          x0: currentXRef.value,
          y0: currentYRef.value,
          rxIn: cmd.rx,
          ryIn: cmd.ry,
          rotationDeg: cmd.rotation,
          largeArc: cmd.largeArc,
          sweep: cmd.sweep,
          x: cmd.x,
          y: cmd.y,
        });
        for (const seg of arcCubics) {
          flattenCubicBezier({
            x0: seg.x0, y0: seg.y0,
            x1: seg.x1, y1: seg.y1,
            x2: seg.x2, y2: seg.y2,
            x3: seg.x3, y3: seg.y3,
            tolerance,
            points,
            depth: BEZIER_MAX_DEPTH,
          });
        }
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        break;
      }

      case "Z":
        if (currentXRef.value !== startXRef.value || currentYRef.value !== startYRef.value) {
          points.push(startXRef.value, startYRef.value);
        }
        currentXRef.value = startXRef.value;
        currentYRef.value = startYRef.value;
        break;
    }
  }

  return points;
}
