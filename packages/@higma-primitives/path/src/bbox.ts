/**
 * @file Axis-aligned bounding box of a path command stream.
 */

import { arcToCubicBeziers } from "./arc";
import type { Bbox, PathCommand } from "./types";

const EMPTY_BBOX: Bbox = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Compute the axis-aligned bounding box of a path command stream.
 *
 * The bbox covers every endpoint and every Bézier control point of the
 * path. This is a *control-hull* bounding box — strictly an upper
 * bound on the rendered geometry (curves stay inside the convex hull
 * of their control points). It is intentionally NOT the tight rendered
 * bbox: callers that need exact Bézier extrema must compute curve
 * derivatives separately. The control-hull definition matches the
 * three private impls this function consolidates
 * (`guid-translation.ts:pathCommandsExtent`,
 *  `render-culling.ts:pathBounds` — which flattens first then takes
 *   extents, an equivalent measure for polylines —, and
 *  `geometry-clusters.ts:collectCoordsBbox`), so swapping in the
 * shared implementation preserves their behaviour.
 *
 * Arc handling: the arc is converted via `arcToCubicBeziers` and the
 * resulting cubic control points join the extent tracker. This is the
 * Arc-aware behaviour the refactor brief requested; the previous
 * `geometry-clusters` impl deliberately threw on Arc, but the input
 * channel that feeds clustering (blob-decoded geometry) never emits
 * Arc, so the upgrade is invisible at that call site.
 *
 * Empty input or input with no endpoint-bearing commands returns
 * `{ x: 0, y: 0, w: 0, h: 0 }` so consumers can treat "no bbox" as a
 * zero-area region without a nullable wrapper.
 */
export function pathCommandsBoundingBox(commands: readonly PathCommand[]): Bbox {
  if (commands.length === 0) {
    return EMPTY_BBOX;
  }
  const tracker = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    touched: false,
  };
  const includeXY = (x: number, y: number): void => {
    tracker.touched = true;
    if (x < tracker.minX) { tracker.minX = x; }
    if (x > tracker.maxX) { tracker.maxX = x; }
    if (y < tracker.minY) { tracker.minY = y; }
    if (y > tracker.maxY) { tracker.maxY = y; }
  };

  let currentX = 0;
  let currentY = 0;

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
      case "L":
        includeXY(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "C":
        includeXY(cmd.x1, cmd.y1);
        includeXY(cmd.x2, cmd.y2);
        includeXY(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "Q":
        includeXY(cmd.x1, cmd.y1);
        includeXY(cmd.x, cmd.y);
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      case "A": {
        const cubics = arcToCubicBeziers({
          x0: currentX,
          y0: currentY,
          rxIn: cmd.rx,
          ryIn: cmd.ry,
          rotationDeg: cmd.rotation,
          largeArc: cmd.largeArc,
          sweep: cmd.sweep,
          x: cmd.x,
          y: cmd.y,
        });
        for (const seg of cubics) {
          includeXY(seg.x1, seg.y1);
          includeXY(seg.x2, seg.y2);
          includeXY(seg.x3, seg.y3);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;
      }
      case "Z":
        // Z snaps to subpath start; no new extent contribution.
        break;
    }
  }

  if (!tracker.touched) {
    return EMPTY_BBOX;
  }
  return {
    x: tracker.minX,
    y: tracker.minY,
    w: tracker.maxX - tracker.minX,
    h: tracker.maxY - tracker.minY,
  };
}

/**
 * Bbox over a list of contours. Empty / no-endpoint input returns
 * `undefined` so callers can distinguish "geometry was empty" from a
 * zero-area bbox at the origin — paint resolvers depend on this
 * distinction to fall back to a node's declared width/height when the
 * stored geometry is empty.
 *
 * Structural typing: callers in renderers and codegen tools each have
 * their own `PathContour` extension (e.g. `fillOverride`), so this
 * accepts the minimal shape that bbox computation needs.
 */
export function pathContoursBoundingBox(
  contours: readonly { readonly commands: readonly PathCommand[] }[],
): Bbox | undefined {
  let any = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    if (c.commands.length === 0) { continue; }
    const b = pathCommandsBoundingBox(c.commands);
    if (b.w === 0 && b.h === 0 && b.x === 0 && b.y === 0) { continue; }
    any = true;
    if (b.x < minX) { minX = b.x; }
    if (b.y < minY) { minY = b.y; }
    if (b.x + b.w > maxX) { maxX = b.x + b.w; }
    if (b.y + b.h > maxY) { maxY = b.y + b.h; }
  }
  if (!any) { return undefined; }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
