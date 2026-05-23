/**
 * @file Reconstruct a stroke centerline from a pre-expanded thin-stroke
 * outline (the 6-vertex rectangle pattern Figma's exporter emits when a
 * vector node has only `strokeGeometry`).
 *
 * Used by the fig render path to match Figma's SVG export pixel-for-
 * pixel: filling the expanded outline rasterises with subtly different
 * antialiasing than re-stroking the centerline, so when the input
 * matches the thin-stroke pattern we reconstruct the centerline and
 * stroke it directly.
 */

import type { PathCommand } from "./types";

const EPS = 1e-3;

type Point = { readonly x: number; readonly y: number };

type Segment = {
  readonly a: Point;
  readonly b: Point;
};

/** Minimal contour shape consumed by the centerline reconstructor. */
type CenterlineInputContour = { readonly commands: readonly PathCommand[] };

/** Centerline output: M+L polyline with non-zero fill rule. */
export type CenterlineContour = {
  readonly commands: readonly PathCommand[];
  readonly windingRule: "nonzero";
};

function dist(p: Point, q: Point): number {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function near(p: Point, q: Point, eps = EPS): boolean {
  return Math.abs(p.x - q.x) <= eps && Math.abs(p.y - q.y) <= eps;
}

/**
 * Split a flat command stream into subpaths, one per `M`. Each subpath
 * is a sequence of points; only `M` and `L` commands are accepted
 * (Bezier curves cannot represent the rectangular outline of a thin
 * stroke).
 */
function commandsToSubpaths(commands: readonly PathCommand[]): Point[][] | undefined {
  const subpaths: Point[][] = [];
  let current: Point[] | undefined;
  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        current = [{ x: cmd.x, y: cmd.y }];
        subpaths.push(current);
        continue;
      case "L":
        if (current === undefined) { return undefined; }
        current.push({ x: cmd.x, y: cmd.y });
        continue;
      case "Z":
        continue;
    }
    return undefined;
  }
  return subpaths;
}

/**
 * Try to interpret a closed 6-vertex contour as a single rectangular
 * stroke segment of width `expectedWidth`. Returns the centerline
 * `{a, b}` or undefined.
 */
function tryDetectSegment(verts: readonly Point[], expectedWidth: number): Segment | undefined {
  if (verts.length !== 7) {
    return undefined;
  }
  if (!near(verts[0], verts[6])) {
    return undefined;
  }

  const a = verts[0];
  const b = verts[3];

  const apPlus = verts[1];
  const bpPlus = verts[2];
  const bpMinus = verts[4];
  const apMinus = verts[5];

  const halfW = expectedWidth / 2;

  const dAplus = dist(a, apPlus);
  const dAminus = dist(a, apMinus);
  const dBplus = dist(b, bpPlus);
  const dBminus = dist(b, bpMinus);

  const widthEps = Math.max(0.05, expectedWidth * 0.1);
  if (Math.abs(dAplus - halfW) > widthEps) { return undefined; }
  if (Math.abs(dAminus - halfW) > widthEps) { return undefined; }
  if (Math.abs(dBplus - halfW) > widthEps) { return undefined; }
  if (Math.abs(dBminus - halfW) > widthEps) { return undefined; }

  const ab = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
  if (len < EPS) { return undefined; }
  const ux = ab.x / len;
  const uy = ab.y / len;

  const expectedPlus = { x: -uy * halfW, y: ux * halfW };
  const expectedMinus = { x: uy * halfW, y: -ux * halfW };

  const obsAplus = { x: apPlus.x - a.x, y: apPlus.y - a.y };
  const obsAminus = { x: apMinus.x - a.x, y: apMinus.y - a.y };
  const obsBplus = { x: bpPlus.x - b.x, y: bpPlus.y - b.y };
  const obsBminus = { x: bpMinus.x - b.x, y: bpMinus.y - b.y };

  const nearVec = (p: Point, q: Point) => Math.abs(p.x - q.x) <= widthEps && Math.abs(p.y - q.y) <= widthEps;

  const orientationOne =
    nearVec(obsAplus, expectedPlus) &&
    nearVec(obsAminus, expectedMinus) &&
    nearVec(obsBplus, expectedPlus) &&
    nearVec(obsBminus, expectedMinus);
  const orientationTwo =
    nearVec(obsAplus, expectedMinus) &&
    nearVec(obsAminus, expectedPlus) &&
    nearVec(obsBplus, expectedMinus) &&
    nearVec(obsBminus, expectedPlus);

  if (!orientationOne && !orientationTwo) {
    return undefined;
  }

  return { a, b };
}

/**
 * Detect that a closed contour represents a stroke cap as Figma
 * generates it: 5 path entries (4 distinct vertices + closing repeat
 * of the first), all 4 vertices equidistant (≈ strokeWidth/2) from
 * their centroid, forming a regular square/diamond.
 */
function isCapContour(verts: readonly Point[], expectedWidth: number): boolean {
  if (verts.length !== 5) { return false; }
  if (!near(verts[0], verts[4])) { return false; }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < 4; i++) {
    cx += verts[i].x;
    cy += verts[i].y;
  }
  cx /= 4;
  cy /= 4;

  const halfW = expectedWidth / 2;
  const tol = Math.max(0.05, expectedWidth * 0.15);
  for (let i = 0; i < 4; i++) {
    const d = dist(verts[i], { x: cx, y: cy });
    if (Math.abs(d - halfW) > tol) { return false; }
  }
  return true;
}

/**
 * Chain segments that share endpoints into open polylines.
 */
function chainSegments(segments: readonly Segment[]): Point[][] {
  if (segments.length === 0) { return []; }

  const used = new Array<boolean>(segments.length).fill(false);
  const polylines: Point[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) { continue; }
    used[i] = true;
    const poly: Point[] = [segments[i].a, segments[i].b];

    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) { continue; }
        const seg = segments[j];
        const head = poly[0];
        const tail = poly[poly.length - 1];
        if (near(seg.a, tail)) {
          poly.push(seg.b);
          used[j] = true;
          extended = true;
          continue;
        }
        if (near(seg.b, tail)) {
          poly.push(seg.a);
          used[j] = true;
          extended = true;
          continue;
        }
        if (near(seg.a, head)) {
          poly.unshift(seg.b);
          used[j] = true;
          extended = true;
          continue;
        }
        if (near(seg.b, head)) {
          poly.unshift(seg.a);
          used[j] = true;
          extended = true;
        }
      }
    }
    polylines.push(poly);
  }

  return polylines;
}

/**
 * Cubic-Bezier control offset for a circular quadrant: `4·(√2−1)/3`.
 * Reproducing a circle quadrant with one cubic Bezier produces this
 * canonical control-point distance from each endpoint along the
 * tangent direction; the resulting curve agrees with the true circle
 * to within ~6e-4 of the radius.
 */
const CIRCLE_QUADRANT_KAPPA = 0.5522847498307933;

/**
 * Try to recognise the entire contour set as a thin circular annulus —
 * Figma's baked-stroke representation of a stroked circle/ellipse where
 * the outline traces the outer rim, then the inner rim, joined by
 * tiny radial bridges. The pre-expanded form uses cubic Beziers (so
 * `commandsToSubpaths` rejects it), and the rectangular `tryDetectSegment`
 * pattern doesn't apply. Detected via the geometric invariant: every
 * anchor endpoint lies at one of three radial distances from a shared
 * center — the inner edge (R − w/2), the centerline (R), or the outer
 * edge (R + w/2). When that pattern holds, emit a single closed cubic-
 * Bezier centerline circle that the renderer then strokes natively,
 * matching Figma's SVG-exporter byte pattern for icon-template guide
 * circles (App Store template's app-icon mask rings, etc.).
 */
function tryDetectCircularAnnulus(
  contours: readonly CenterlineInputContour[],
  strokeWeight: number,
): CenterlineContour[] | undefined {
  if (contours.length === 0) { return undefined; }

  // Collect every anchor endpoint across all commands. Bezier control
  // points (C.x1/y1, C.x2/y2 and Q.x1/y1) are off-curve and must be
  // skipped — only the curve endpoints lie on the geometric path.
  const points: Point[] = [];
  for (const c of contours) {
    for (const cmd of c.commands) {
      if (cmd.type === "M" || cmd.type === "L") {
        points.push({ x: cmd.x, y: cmd.y });
        continue;
      }
      if (cmd.type === "C") {
        points.push({ x: cmd.x, y: cmd.y });
        continue;
      }
      if (cmd.type === "Q") {
        points.push({ x: cmd.x, y: cmd.y });
        continue;
      }
      if (cmd.type === "A") {
        points.push({ x: cmd.x, y: cmd.y });
      }
      // "Z" carries no coordinate.
    }
  }
  // Need at least 8 points: 4 outer-arc endpoints + 4 inner-arc
  // endpoints for a fully-baked 4-quadrant annulus.
  if (points.length < 8) { return undefined; }

  // Estimate the shared center as the centroid of all endpoints. The
  // anchor points sit symmetrically on the inner+outer arcs and on
  // the radial bridges between them, so their centroid coincides with
  // the circle's geometric center to within numerical noise.
  let cx = 0;
  let cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  // Distance from the estimated center to each anchor point.
  const distances = points.map((p) => Math.hypot(p.x - cx, p.y - cy));

  let minR = Infinity;
  let maxR = -Infinity;
  for (const d of distances) {
    if (d < minR) { minR = d; }
    if (d > maxR) { maxR = d; }
  }

  // The outer/inner gap must match the supplied stroke width, with a
  // small absolute floor for very-thin (≪1px) strokes whose baked
  // geometry rounds noticeably under f32 precision.
  const observedWidth = maxR - minR;
  const widthEps = Math.max(0.05, strokeWeight * 0.3);
  if (Math.abs(observedWidth - strokeWeight) > widthEps) { return undefined; }

  // Every anchor must lie close to one of three rings: the inner edge,
  // the centerline midR, or the outer edge. Anything else (an off-
  // center anchor, a stray vertex from a different shape) disqualifies
  // the whole contour set so we fall back to the safe fill-the-outline
  // path.
  const midR = (minR + maxR) / 2;
  const distEps = Math.max(0.05, strokeWeight * 0.5);
  for (const d of distances) {
    if (Math.abs(d - minR) < distEps) { continue; }
    if (Math.abs(d - midR) < distEps) { continue; }
    if (Math.abs(d - maxR) < distEps) { continue; }
    return undefined;
  }

  // A degenerate "circle" of radius zero would emit a single point.
  // Refuse — caller will fall back to filling.
  if (midR <= 0) { return undefined; }

  const k = CIRCLE_QUADRANT_KAPPA * midR;
  const commands: PathCommand[] = [
    { type: "M", x: cx + midR, y: cy },
    { type: "C", x1: cx + midR, y1: cy + k, x2: cx + k,    y2: cy + midR, x: cx,        y: cy + midR },
    { type: "C", x1: cx - k,    y1: cy + midR, x2: cx - midR, y2: cy + k, x: cx - midR, y: cy },
    { type: "C", x1: cx - midR, y1: cy - k, x2: cx - k,    y2: cy - midR, x: cx,        y: cy - midR },
    { type: "C", x1: cx + k,    y1: cy - midR, x2: cx + midR, y2: cy - k, x: cx + midR, y: cy },
    { type: "Z" },
  ];

  return [{ commands, windingRule: "nonzero" }];
}

/**
 * Try reconstructing a centerline from a pre-expanded strokeGeometry
 * outline. Returns the centerline contours when every body contour
 * matches the thin stroke pattern; otherwise returns undefined so the
 * caller can fall back to filling the original outline.
 */
export function reconstructStrokeCenterline(
  contours: readonly CenterlineInputContour[],
  strokeWeight: number,
): CenterlineContour[] | undefined {
  if (contours.length === 0 || strokeWeight <= 0) { return undefined; }

  // Circular-annulus detection runs first because its geometric
  // invariant (three concentric radii, gap == strokeWeight) cannot be
  // produced by the rectangular thin-stroke pattern, and it consumes
  // the Bezier-curve baked output that `commandsToSubpaths` refuses
  // to flatten. If the annulus probe rejects, fall through to the
  // rect/line pattern below — both paths are mutually exclusive on
  // real Figma input.
  const annulus = tryDetectCircularAnnulus(contours, strokeWeight);
  if (annulus) { return annulus; }

  const segments: Segment[] = [];
  for (const c of contours) {
    const subpaths = commandsToSubpaths(c.commands);
    if (!subpaths) { return undefined; }
    for (const verts of subpaths) {
      if (verts.length === 0) { continue; }

      if (isCapContour(verts, strokeWeight)) {
        continue;
      }
      const seg = tryDetectSegment(verts, strokeWeight);
      if (!seg) { return undefined; }
      segments.push(seg);
    }
  }

  if (segments.length === 0) { return undefined; }

  const polylines = chainSegments(segments);

  return polylines.map<CenterlineContour>((poly) => {
    const commands: PathCommand[] = [];
    commands.push({ type: "M", x: poly[0].x, y: poly[0].y });
    for (let k = 1; k < poly.length; k++) {
      commands.push({ type: "L", x: poly[k].x, y: poly[k].y });
    }
    return {
      commands,
      windingRule: "nonzero",
    };
  });
}
