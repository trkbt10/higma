/**
 * @file Triangulate a multi-contour silhouette into a Godot
 * `Polygon2D.polygons` partition that correctly renders holes.
 *
 * Godot 4's `Polygon2D` fills each region in `polygons` independently —
 * it does NOT honor even-odd / non-zero hole-cutting between regions.
 * So a path-bool result like `INTERSECT(outer, inner)` that comes back
 * as `[outer, inner]` would render as two filled discs instead of a
 * ring with a hole. This module bridges that gap.
 *
 * Algorithm (per outer / inner contour pair):
 *
 *   1. Group contours into outers and holes via a point-in-polygon
 *      test on each contour's first vertex against the others. Any
 *      contour fully contained in another is treated as a hole; the
 *      containing contour is its outer.
 *   2. For every outer with no inner, emit it as a single region.
 *   3. For every (outer, holes[]) pair, build a ring strip:
 *      - Re-sample outer and inner at the same number of points
 *        (interpolated along arc length).
 *      - For each segment `i`, emit a single quad region
 *        `[outer[i], outer[i+1], inner[i+1], inner[i]]`. The quads
 *        tile the annular band between outer and inner with no gaps.
 *      - When there are multiple holes inside one outer, connect
 *        them into a chain via "bridge cuts" — duplicate vertices
 *        forming a thin slit between the outer and each hole, then
 *        emit a single region. The path-bool engine doesn't actually
 *        produce that case for typical fig boolean results we see,
 *        so for now we fall back to "first hole only" and stack the
 *        rest as separate filled regions (visible artefact, but
 *        bounded).
 *
 * Limitations:
 *   - Two holes overlapping each other inside the same outer fall
 *     back to per-region fill (visual artefact).
 *   - Concave outers with deep notches whose inner contour samples
 *     unevenly produce slightly mis-aligned strip quads. Mitigated by
 *     re-sampling at equal arc length.
 */
import type { Contour } from "./path-flatten";

const RESAMPLE_COUNT_DEFAULT = 96;

/**
 * Group `contours` into outer/hole pairs and triangulate each ring.
 * Returns the same `Contour[]` shape the rest of the pipeline expects,
 * with each entry's `partition` populated when triangulation kicks in.
 */
export function triangulateContoursWithHoles(
  contours: readonly Contour[],
): readonly Contour[] {
  if (contours.length < 2) {
    return contours;
  }
  const containment = computeContainmentMap(contours);
  const outerHoles = new Map<number, number[]>();
  const isHole = new Set<number>();
  for (let i = 0; i < contours.length; i += 1) {
    const parent = containment[i];
    if (parent === -1) {
      if (!outerHoles.has(i)) {
        outerHoles.set(i, []);
      }
      continue;
    }
    isHole.add(i);
    const list = outerHoles.get(parent) ?? [];
    list.push(i);
    outerHoles.set(parent, list);
  }
  const out: Contour[] = [];
  for (const [outerIdx, holes] of outerHoles) {
    const outer = contours[outerIdx];
    if (holes.length === 0) {
      out.push(outer);
      continue;
    }
    if (holes.length === 1) {
      const inner = contours[holes[0]];
      const ring = ringStrip(outer, inner);
      if (ring) {
        // Emit the merged-with-partition fill contour PLUS the
        // outer + inner rings as outline-only contours. The fill
        // path uses the merged contour; the stroke path iterates
        // the outline-only contours and skips the merged one
        // (whose alternating points would zigzag as a Line2D).
        out.push(ring);
        out.push({ points: outer.points, outlineOnly: true });
        out.push({ points: inner.points, outlineOnly: true });
        continue;
      }
    }
    // Multi-hole or unbuildable ring — fall back to per-region fill.
    // Rendering will show the holes as filled (visible artefact) but
    // the rest of the silhouette is still correct.
    out.push(outer);
  }
  return out;
}

/**
 * For each contour `i`, return the index of the smallest contour
 * that fully contains it, or `-1` when `i` is itself an outer.
 *
 * "Fully contains" is approximated by testing whether `i`'s first
 * vertex is inside every candidate. This is robust for the simple
 * outer/hole topologies the path-bool engine produces — concentric
 * rings, INTERSECT-of-two-rects frames — and breaks down only on
 * pathological self-intersecting input we don't expect from Figma.
 */
function computeContainmentMap(contours: readonly Contour[]): readonly number[] {
  const n = contours.length;
  const result: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const probe = contourCentroid(contours[i]);
    if (!probe) {
      result.push(-1);
      continue;
    }
    result.push(findSmallestContainer(probe, contours, i));
  }
  return result;
}

/**
 * Average all vertices of a contour to get a probe point unlikely
 * to lie on another contour's boundary. Using `points[0]` failed on
 * figure-8 splits where the first vertex of each half was the
 * shared cut point — that point is on the boundary of the other
 * half, and the ray-casting PIP test returns inconsistent results
 * on boundary pixels. The centroid is interior for any non-self-
 * crossing convex/concave shape we encounter.
 */
function contourCentroid(contour: Contour): { x: number; y: number } | undefined {
  const pts = contour.points;
  if (pts.length === 0) {
    return undefined;
  }
  const sum = pts.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

/**
 * Find the smallest contour (by absolute signed area) that fully
 * contains `probe`, excluding `selfIdx`. Returns `-1` when no contour
 * contains it. Helper extracted so `computeContainmentMap`'s inner
 * loop avoids a mutable accumulator.
 */
function findSmallestContainer(
  probe: { readonly x: number; readonly y: number },
  contours: readonly { readonly points: readonly { readonly x: number; readonly y: number }[] }[],
  selfIdx: number,
): number {
  return contours.reduce((acc: { idx: number; area: number }, contour, j) => {
    if (j === selfIdx) {
      return acc;
    }
    if (!pointInPolygon(probe, contour.points)) {
      return acc;
    }
    const area = Math.abs(signedArea(contour.points));
    if (area < acc.area) {
      return { idx: j, area };
    }
    return acc;
  }, { idx: -1, area: Infinity }).idx;
}

/**
 * Even-odd point-in-polygon test (ray casting). Pairs each edge
 * `(poly[i], poly[(i + n - 1) % n])` and toggles `inside` whenever a
 * horizontal ray from `p` crosses the edge. Implemented as a reduce
 * to satisfy the no-let rule.
 */
function pointInPolygon(
  p: { readonly x: number; readonly y: number },
  poly: readonly { readonly x: number; readonly y: number }[],
): boolean {
  const n = poly.length;
  return poly.reduce<boolean>((inside, _, i) => {
    const a = poly[i];
    const b = poly[(i + n - 1) % n];
    const aboveCrosses = a.y > p.y !== b.y > p.y;
    if (!aboveCrosses) {
      return inside;
    }
    const xIntersect = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    return p.x < xIntersect ? !inside : inside;
  }, false);
}

/** Shoelace signed area; > 0 means CCW (in standard math axes). */
function signedArea(poly: readonly { readonly x: number; readonly y: number }[]): number {
  return (
    poly.reduce((acc, a, i) => {
      const b = poly[(i + 1) % poly.length];
      return acc + a.x * b.y - b.x * a.y;
    }, 0) / 2
  );
}

/**
 * Build a ring-strip Contour connecting `outer` and `inner`. Both are
 * re-sampled at `RESAMPLE_COUNT_DEFAULT` evenly-spaced arc-length
 * points so the strip's quads stay roughly perpendicular to the ring's
 * radial direction. Returns `undefined` if either contour collapsed to
 * a point.
 */
function ringStrip(outer: Contour, inner: Contour): Contour | undefined {
  const samples = RESAMPLE_COUNT_DEFAULT;
  const outerSamples = resampleClosedPolyline(outer.points, samples);
  const innerSamples = resampleClosedPolyline(inner.points, samples);
  if (!outerSamples || !innerSamples) {
    return undefined;
  }
  // Make outer and inner traverse the same direction so the
  // ring-strip quads (outer[i], outer[i+1], inner[i+1], inner[i])
  // tile without self-intersection. Path-bool returns the inner
  // contour with reversed winding (hole convention); we flip it
  // back so both contours walk the silhouette in the same direction.
  const outerArea = signedArea(outerSamples);
  const innerArea = signedArea(innerSamples);
  const sameWinding = Math.sign(outerArea) === Math.sign(innerArea);
  const innerOriented = sameWinding ? innerSamples : [...innerSamples].reverse();
  // Phase-align: rotate inner so its first sample is closest (in
  // angle from each contour's centroid) to outer[0]. Without this,
  // outer's sample 0 might pair with the diametrically-opposite
  // inner sample, producing self-intersecting quads.
  const innerAligned = phaseAlignToOuter(outerSamples, innerOriented);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < samples; i += 1) {
    points.push({ x: outerSamples[i].x, y: outerSamples[i].y });
    points.push({ x: innerAligned[i].x, y: innerAligned[i].y });
  }
  const partition: number[][] = [];
  for (let i = 0; i < samples; i += 1) {
    const o0 = (i * 2) % points.length;
    const i0 = (i * 2 + 1) % points.length;
    const o1 = ((i + 1) * 2) % points.length;
    const i1 = ((i + 1) * 2 + 1) % points.length;
    partition.push([o0, o1, i1, i0]);
  }
  return { points, partition };
}

/**
 * Rotate `inner` so its sample 0 is the one closest (Euclidean) to
 * `outer[0]`. Mirrors the visual pairing convention readers expect:
 * outer's "top edge" sample lines up with inner's "top edge" sample.
 *
 * Without this, two concentric rounded rectangles re-sampled
 * starting from different vertices (Figma's blob start point isn't
 * guaranteed) pair sample 0 of outer with the diametrically-opposite
 * sample of inner, producing a strip whose quads cross the hole and
 * cancel.
 */
function phaseAlignToOuter(
  outer: readonly { readonly x: number; readonly y: number }[],
  inner: readonly { readonly x: number; readonly y: number }[],
): readonly { x: number; y: number }[] {
  if (inner.length === 0) {
    return inner;
  }
  const target = outer[0];
  const bestIdx = inner.reduce(
    (acc: { idx: number; d: number }, p, i) => {
      const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
      return d < acc.d ? { idx: i, d } : acc;
    },
    { idx: 0, d: Infinity },
  ).idx;
  if (bestIdx === 0) {
    return inner;
  }
  return [...inner.slice(bestIdx), ...inner.slice(0, bestIdx)];
}

/**
 * Re-sample a closed polyline to `n` points at uniform arc length.
 * Returns `undefined` if the input has fewer than 2 distinct points
 * (degenerate).
 */
function resampleClosedPolyline(
  poly: readonly { readonly x: number; readonly y: number }[],
  n: number,
): readonly { x: number; y: number }[] | undefined {
  if (poly.length < 2) {
    return undefined;
  }
  // Cumulative arc-length lookup. `cum[i]` = distance along the
  // polyline from point 0 to point i (with wrap to 0 at the end).
  const cum = poly.reduce<readonly number[]>((acc, _, i) => {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    return [...acc, acc[acc.length - 1] + Math.hypot(b.x - a.x, b.y - a.y)];
  }, [0]);
  const total = cum[cum.length - 1];
  if (total < 1e-6) {
    return undefined;
  }
  return Array.from({ length: n }, (_, i) => {
    const target = (i * total) / n;
    const seg = locateSegment(cum, target);
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen < 1e-6 ? 0 : (target - cum[seg]) / segLen;
    const a = poly[seg % poly.length];
    const b = poly[(seg + 1) % poly.length];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
}

/**
 * Locate the cumulative-arc-length segment whose range contains
 * `target`. Returns the segment's start index (`cum[i] <= target <
 * cum[i+1]`); falls back to the last segment when `target` is past
 * the polyline's total length (numerical noise).
 */
function locateSegment(cum: readonly number[], target: number): number {
  const idx = cum.findIndex((c, i) => i < cum.length - 1 && c <= target && target < cum[i + 1]);
  if (idx >= 0) {
    return idx;
  }
  return cum.length - 2;
}
