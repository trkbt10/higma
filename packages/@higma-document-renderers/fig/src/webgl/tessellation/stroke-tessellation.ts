/**
 * @file Stroke tessellation for WebGL rendering
 *
 * Converts stroke outlines to filled triangle meshes by expanding paths
 * into thick polylines.
 */

import { flattenPathCommands, type CornerRadius } from "@higma-primitives/path";
import type { PathContour } from "@higma-document-renderers/fig/scene-graph";
import { triangulate } from "./tessellation";

// =============================================================================
// Polyline Thickening
// =============================================================================

/**
 * Thicken a polyline into a triangle strip.
 *
 * For each segment, computes perpendicular offset on both sides, then
 * generates two triangles per segment (a quad). Uses miter joins.
 *
 * @param points - Flat array of coordinates [x0, y0, x1, y1, ...]
 * @param halfWidth - Half the stroke width
 * @returns Float32Array of triangle vertices
 */
function thickenPolyline(points: readonly number[], halfWidth: number): Float32Array {
  const n = points.length >> 1;
  if (n < 2) {return new Float32Array(0);}

  // Compute per-vertex normals (averaged from adjacent segments)
  const normals: number[] = [];

  for (let i = 0; i < n; i++) {
    const nxRef = { value: 0 };
    const nyRef = { value: 0 };
    const countRef = { value: 0 };

    if (i > 0) {
      appendSegmentNormal({
        nxRef,
        nyRef,
        countRef,
        fromX: points[(i - 1) * 2],
        fromY: points[(i - 1) * 2 + 1],
        toX: points[i * 2],
        toY: points[i * 2 + 1],
      });
    }

    if (i < n - 1) {
      appendSegmentNormal({
        nxRef,
        nyRef,
        countRef,
        fromX: points[i * 2],
        fromY: points[i * 2 + 1],
        toX: points[(i + 1) * 2],
        toY: points[(i + 1) * 2 + 1],
      });
    }

    if (countRef.value <= 0) {
      normals.push(0, 0);
      continue;
    }

    const nx = nxRef.value / countRef.value;
    const ny = nyRef.value / countRef.value;
    const nlen = Math.sqrt(nx * nx + ny * ny);
    if (nlen <= 0) {
      normals.push(0, 0);
      continue;
    }

    normals.push(nx / nlen, ny / nlen);
  }

  // Generate quads (2 triangles each)
  const triangles: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i * 2];
    const y0 = points[i * 2 + 1];
    const x1 = points[(i + 1) * 2];
    const y1 = points[(i + 1) * 2 + 1];

    const nx0 = normals[i * 2];
    const ny0 = normals[i * 2 + 1];
    const nx1 = normals[(i + 1) * 2];
    const ny1 = normals[(i + 1) * 2 + 1];

    // Four corners of the quad
    const ax = x0 + nx0 * halfWidth;
    const ay = y0 + ny0 * halfWidth;
    const bx = x0 - nx0 * halfWidth;
    const by = y0 - ny0 * halfWidth;
    const cx = x1 + nx1 * halfWidth;
    const cy = y1 + ny1 * halfWidth;
    const dx2 = x1 - nx1 * halfWidth;
    const dy2 = y1 - ny1 * halfWidth;

    // Triangle 1: a, b, c
    triangles.push(ax, ay, bx, by, cx, cy);
    // Triangle 2: b, dx2, c
    triangles.push(bx, by, dx2, dy2, cx, cy);
  }

  return new Float32Array(triangles);
}

type StrokeDashOptions = {
  readonly dashPattern?: readonly number[];
};

type PathStrokeOptions = StrokeDashOptions & {
  readonly tolerance?: number;
};

function resolveDashPattern(dashPattern: readonly number[] | undefined): number[] | undefined {
  if (!dashPattern) { return undefined; }
  const positive = dashPattern.filter((value) => Number.isFinite(value) && value > 0);
  if (positive.length === 0) { return undefined; }
  if (positive.length % 2 === 0) { return positive; }
  return [...positive, ...positive];
}

function samePoint(
  { ax, ay, bx, by }: { ax: number; ay: number; bx: number; by: number },
): boolean {
  return Math.abs(ax - bx) < 0.001 && Math.abs(ay - by) < 0.001;
}

function appendDrawnDashPoint(
  { current, x, y }: { current: number[]; x: number; y: number },
): void {
  if (current.length === 0) {
    current.push(x, y);
    return;
  }
  const lastX = current[current.length - 2];
  const lastY = current[current.length - 1];
  if (!samePoint({ ax: lastX, ay: lastY, bx: x, by: y })) {
    current.push(x, y);
  }
}

function pushCompletedDashSegment(
  { segments, current }: { segments: number[][]; current: number[] },
): void {
  if (current.length >= 4) {
    segments.push([...current]);
  }
  current.length = 0;
}

function splitPolylineByDashPattern(
  points: readonly number[],
  dashPattern: readonly number[] | undefined,
): number[][] {
  const pattern = resolveDashPattern(dashPattern);
  if (!pattern) { return [Array.from(points)]; }

  const segments: number[][] = [];
  const current: number[] = [];
  const dashIndexRef = { value: 0 };
  const remainingRef = { value: pattern[0] };
  const drawRef = { value: true };

  for (let i = 0; i < points.length - 2; i += 2) {
    const x0 = points[i];
    const y0 = points[i + 1];
    const x1 = points[i + 2];
    const y1 = points[i + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    if (segmentLength <= 0) { continue; }

    const offsetRef = { value: 0 };
    while (offsetRef.value < segmentLength) {
      const step = Math.min(remainingRef.value, segmentLength - offsetRef.value);
      const startT = offsetRef.value / segmentLength;
      const endT = (offsetRef.value + step) / segmentLength;
      const sx = x0 + dx * startT;
      const sy = y0 + dy * startT;
      const ex = x0 + dx * endT;
      const ey = y0 + dy * endT;

      if (drawRef.value) {
        appendDrawnDashPoint({ current, x: sx, y: sy });
        appendDrawnDashPoint({ current, x: ex, y: ey });
      }

      offsetRef.value += step;
      remainingRef.value -= step;

      if (remainingRef.value <= 0.001) {
        advanceDashPattern({ segments, current, pattern, dashIndexRef, remainingRef, drawRef });
      }
    }
  }

  pushCompletedDashSegment({ segments, current });
  return segments;
}

function thickenDashedPolyline(
  { points, halfWidth, dashPattern }: { points: readonly number[]; halfWidth: number; dashPattern?: readonly number[] },
): Float32Array {
  const dashedSegments = splitPolylineByDashPattern(points, dashPattern);
  const vertexBuffers = dashedSegments.map((segment) => thickenPolyline(segment, halfWidth));
  const totalLength = vertexBuffers.reduce((sum, vertices) => sum + vertices.length, 0);
  const result = new Float32Array(totalLength);
  const offsetRef = { value: 0 };
  for (const vertices of vertexBuffers) {
    result.set(vertices, offsetRef.value);
    offsetRef.value += vertices.length;
  }
  return result;
}

function appendSegmentNormal(
  { nxRef, nyRef, countRef, fromX, fromY, toX, toY }: {
    readonly nxRef: { value: number };
    readonly nyRef: { value: number };
    readonly countRef: { value: number };
    readonly fromX: number;
    readonly fromY: number;
    readonly toX: number;
    readonly toY: number;
  },
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 0) {
    return;
  }

  nxRef.value += -dy / len;
  nyRef.value += dx / len;
  countRef.value++;
}

function advanceDashPattern(
  { segments, current, pattern, dashIndexRef, remainingRef, drawRef }: {
    readonly segments: number[][];
    readonly current: number[];
    readonly pattern: readonly number[];
    readonly dashIndexRef: { value: number };
    readonly remainingRef: { value: number };
    readonly drawRef: { value: boolean };
  },
): void {
  if (drawRef.value) {
    pushCompletedDashSegment({ segments, current });
  }

  dashIndexRef.value = (dashIndexRef.value + 1) % pattern.length;
  remainingRef.value = pattern[dashIndexRef.value];
  drawRef.value = dashIndexRef.value % 2 === 0;
}

// =============================================================================
// Rectangle Stroke
// =============================================================================

type RectStrokeAlign = "INSIDE" | "OUTSIDE";
type RectCornerRadii = readonly [number, number, number, number];

/**
 * Tessellate a rectangle stroke as outer ring minus inner ring.
 *
 * @param w - Rectangle width
 * @param h - Rectangle height
 * @param cornerRadius - Corner radius (0 for sharp corners)
 * @param strokeWidth - Stroke width
 * @returns Float32Array of triangle vertices
 */
export function tessellateRectStroke(
  { w, h, cornerRadius, strokeWidth, dashPattern }: {
    w: number;
    h: number;
    cornerRadius: CornerRadius | undefined;
    strokeWidth: number;
    dashPattern?: readonly number[];
  }
): Float32Array {
  if (strokeWidth <= 0) { return new Float32Array(0); }
  if (dashPattern) {
    return tessellateDashedRectStroke({ w, h, cornerRadius, strokeWidth, dashPattern });
  }

  const hw = strokeWidth / 2;
  const radii = clampRectCornerRadii({ w, h, cornerRadius });

  if (!hasRoundedCorner(radii)) {
    // Simple rectangle: generate outer and inner rect, triangulate the ring
    return tessellateRing(
      rectPoints({ w: w + hw * 2, h: h + hw * 2, offX: -hw, offY: -hw }),
      rectPoints({ w: w - hw * 2, h: h - hw * 2, offX: hw, offY: hw })
    );
  }

  // Rounded rectangle stroke
  const segments = 8;
  const outerW = w + hw * 2;
  const outerH = h + hw * 2;
  const innerW = w - hw * 2;
  const innerH = h - hw * 2;
  const outerRadii = clampRectCornerRadii({ w: outerW, h: outerH, cornerRadius: offsetRectCornerRadii(radii, hw) });
  const innerRadii = clampRectCornerRadii({ w: innerW, h: innerH, cornerRadius: offsetRectCornerRadii(radii, -hw) });

  if (innerW <= 0 || innerH <= 0) {
    // Stroke is thicker than the shape, just fill the outer
    const outer = roundedRectPoints({ w: outerW, h: outerH, radii: outerRadii, offX: -hw, offY: -hw, segments });
    const indices = triangulate(outer);
    return indicesToVertices(outer, indices);
  }

  const outer = roundedRectPoints({ w: outerW, h: outerH, radii: outerRadii, offX: -hw, offY: -hw, segments });
  const inner = roundedRectPoints({ w: innerW, h: innerH, radii: innerRadii, offX: hw, offY: hw, segments });
  return tessellateRing(outer, inner);
}

/**
 * Tessellate an aligned rectangle stroke as direct ring geometry.
 */
export function tessellateRectAlignedStroke(
  { w, h, cornerRadius, strokeWidth, align }: { w: number; h: number; cornerRadius: CornerRadius | undefined; strokeWidth: number; align: RectStrokeAlign; }
): Float32Array {
  if (strokeWidth <= 0) { return new Float32Array(0); }

  const radii = clampRectCornerRadii({ w, h, cornerRadius });
  if (!hasRoundedCorner(radii)) {
    return tessellateSharpRectAlignedStroke({ w, h, strokeWidth, align });
  }

  return tessellateRoundedRectAlignedStroke({ w, h, radii, strokeWidth, align });
}

// =============================================================================
// Ellipse Stroke
// =============================================================================

/**
 * Tessellate an ellipse stroke as outer ring minus inner ring.
 */
export function tessellateEllipseStroke(
  { cx, cy, rx, ry, strokeWidth, segments = 64, dashPattern }: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    strokeWidth: number;
    segments?: number;
    dashPattern?: readonly number[];
  }
): Float32Array {
  if (strokeWidth <= 0) { return new Float32Array(0); }
  if (dashPattern) {
    const points = ellipsePoints({ cx, cy, rx, ry, segments });
    points.push(points[0], points[1]);
    return thickenDashedPolyline({ points, halfWidth: strokeWidth / 2, dashPattern });
  }

  const hw = strokeWidth / 2;
  const outerRx = rx + hw;
  const outerRy = ry + hw;
  const innerRx = Math.max(rx - hw, 0);
  const innerRy = Math.max(ry - hw, 0);

  if (innerRx <= 0 || innerRy <= 0) {
    // Stroke fills the entire ellipse
    const outer = ellipsePoints({ cx, cy, rx: outerRx, ry: outerRy, segments });
    const indices = triangulate(outer);
    return indicesToVertices(outer, indices);
  }

  const outer = ellipsePoints({ cx, cy, rx: outerRx, ry: outerRy, segments });
  const inner = ellipsePoints({ cx, cy, rx: innerRx, ry: innerRy, segments });
  return tessellateRing(outer, inner);
}

// =============================================================================
// Path Stroke
// =============================================================================

/**
 * Tessellate a path stroke by thickening each contour's polyline.
 */
export function tessellatePathStroke(
  contours: readonly PathContour[],
  strokeWidth: number,
  options: number | PathStrokeOptions = 0.25
): Float32Array {
  if (strokeWidth <= 0) { return new Float32Array(0); }
  const halfWidth = strokeWidth / 2;
  const tolerance = typeof options === "number" ? options : options.tolerance ?? 0.25;
  const dashPattern = typeof options === "number" ? undefined : options.dashPattern;
  const allVertices: Float32Array[] = [];
  const totalLengthRef = { value: 0 };

  for (const contour of contours) {
    const flatCoords = flattenPathCommands(contour.commands, tolerance);
    if (flatCoords.length < 4) {continue;}

    const vertices = thickenDashedPolyline({ points: flatCoords, halfWidth, dashPattern });
    if (vertices.length > 0) {
      allVertices.push(vertices);
      totalLengthRef.value += vertices.length;
    }
  }

  if (allVertices.length === 0) {return new Float32Array(0);}

  const result = new Float32Array(totalLengthRef.value);
  const offsetRef = { value: 0 };
  for (const vertices of allVertices) {
    result.set(vertices, offsetRef.value);
    offsetRef.value += vertices.length;
  }
  return result;
}

function rectCenterlinePoints(
  { w, h, cornerRadius }: { w: number; h: number; cornerRadius: CornerRadius | undefined },
): number[] {
  const radii = clampRectCornerRadii({ w, h, cornerRadius });
  if (!hasRoundedCorner(radii)) {
    return [0, 0, w, 0, w, h, 0, h, 0, 0];
  }
  const points = roundedRectPoints({ w, h, radii, offX: 0, offY: 0, segments: 8 });
  points.push(points[0], points[1]);
  return points;
}

function tessellateDashedRectStroke(
  { w, h, cornerRadius, strokeWidth, dashPattern }: {
    w: number;
    h: number;
    cornerRadius: CornerRadius | undefined;
    strokeWidth: number;
    dashPattern: readonly number[];
  },
): Float32Array {
  return thickenDashedPolyline({
    points: rectCenterlinePoints({ w, h, cornerRadius }),
    halfWidth: strokeWidth / 2,
    dashPattern,
  });
}

// =============================================================================
// Local Routines
// =============================================================================

function rectPoints(
  { w, h, offX, offY }: { w: number; h: number; offX: number; offY: number; }
): number[] {
  return [
    offX, offY,
    offX + w, offY,
    offX + w, offY + h,
    offX, offY + h,
  ];
}

function tessellateSharpRectAlignedStroke(
  { w, h, strokeWidth, align }: { w: number; h: number; strokeWidth: number; align: RectStrokeAlign; }
): Float32Array {
  if (align === "OUTSIDE") {
    return tessellateRing(
      rectPoints({ w: w + strokeWidth * 2, h: h + strokeWidth * 2, offX: -strokeWidth, offY: -strokeWidth }),
      rectPoints({ w, h, offX: 0, offY: 0 })
    );
  }

  const innerW = w - strokeWidth * 2;
  const innerH = h - strokeWidth * 2;
  const outer = rectPoints({ w, h, offX: 0, offY: 0 });
  if (innerW <= 0 || innerH <= 0) {
    const indices = triangulate(outer);
    return indicesToVertices(outer, indices);
  }

  return tessellateRing(
    outer,
    rectPoints({ w: innerW, h: innerH, offX: strokeWidth, offY: strokeWidth })
  );
}

function tessellateRoundedRectAlignedStroke(
  { w, h, radii, strokeWidth, align }: { w: number; h: number; radii: RectCornerRadii; strokeWidth: number; align: RectStrokeAlign; }
): Float32Array {
  const segments = 8;
  if (align === "OUTSIDE") {
    const outerW = w + strokeWidth * 2;
    const outerH = h + strokeWidth * 2;
    const outerRadii = clampRectCornerRadii({ w: outerW, h: outerH, cornerRadius: offsetRectCornerRadii(radii, strokeWidth) });
    return tessellateRing(
      roundedRectPoints({
        w: outerW,
        h: outerH,
        radii: outerRadii,
        offX: -strokeWidth,
        offY: -strokeWidth,
        segments,
      }),
      roundedRectPoints({ w, h, radii, offX: 0, offY: 0, segments })
    );
  }

  const innerW = w - strokeWidth * 2;
  const innerH = h - strokeWidth * 2;
  const outer = roundedRectPoints({ w, h, radii, offX: 0, offY: 0, segments });
  if (innerW <= 0 || innerH <= 0) {
    const indices = triangulate(outer);
    return indicesToVertices(outer, indices);
  }

  const innerRadii = clampRectCornerRadii({ w: innerW, h: innerH, cornerRadius: offsetRectCornerRadii(radii, -strokeWidth) });
  return tessellateRing(
    outer,
    roundedRectPoints({
      w: innerW,
      h: innerH,
      radii: innerRadii,
      offX: strokeWidth,
      offY: strokeWidth,
      segments,
    })
  );
}

function roundedRectPoints(
  { w, h, radii, offX, offY, segments }: { w: number; h: number; radii: RectCornerRadii; offX: number; offY: number; segments: number; }
): number[] {
  const [tl, tr, br, bl] = radii;
  const points: number[] = [];

  // Trace CW: each corner arc connects to the next via implicit straight edges.
  // Use polar arcs centered at each corner center.

  // Top-right corner: center (w-cr, cr), arc from -π/2 to 0
  pushRoundedCornerPoints({ points, cx: offX + w - tr, cy: offY + tr, radius: tr, startAngle: -Math.PI / 2, endAngle: 0, segments });
  // Bottom-right corner: center (w-cr, h-cr), arc from 0 to π/2
  pushRoundedCornerPoints({ points, cx: offX + w - br, cy: offY + h - br, radius: br, startAngle: 0, endAngle: Math.PI / 2, segments });
  // Bottom-left corner: center (cr, h-cr), arc from π/2 to π
  pushRoundedCornerPoints({ points, cx: offX + bl, cy: offY + h - bl, radius: bl, startAngle: Math.PI / 2, endAngle: Math.PI, segments });
  // Top-left corner: center (cr, cr), arc from π to 3π/2
  pushRoundedCornerPoints({ points, cx: offX + tl, cy: offY + tl, radius: tl, startAngle: Math.PI, endAngle: Math.PI * 1.5, segments });

  return points;
}

function pushRoundedCornerPoints(
  { points, cx, cy, radius, startAngle, endAngle, segments }: {
    readonly points: number[];
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
    readonly startAngle: number;
    readonly endAngle: number;
    readonly segments: number;
  },
): void {
  if (radius <= 0) {
    points.push(cx, cy);
    return;
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
}

function clampRectCornerRadii(
  { w, h, cornerRadius }: { readonly w: number; readonly h: number; readonly cornerRadius: CornerRadius | undefined },
): RectCornerRadii {
  const maxRadius = Math.max(0, Math.min(w / 2, h / 2));
  if (cornerRadius === undefined) {
    return [0, 0, 0, 0];
  }
  if (typeof cornerRadius === "number") {
    const radius = clampCornerRadiusValue(cornerRadius, maxRadius);
    return [radius, radius, radius, radius];
  }
  return [
    clampCornerRadiusValue(cornerRadius[0], maxRadius),
    clampCornerRadiusValue(cornerRadius[1], maxRadius),
    clampCornerRadiusValue(cornerRadius[2], maxRadius),
    clampCornerRadiusValue(cornerRadius[3], maxRadius),
  ];
}

function clampCornerRadiusValue(value: number, maxRadius: number): number {
  return Math.max(0, Math.min(value, maxRadius));
}

function hasRoundedCorner(radii: RectCornerRadii): boolean {
  return radii.some((radius) => radius > 0);
}

function offsetRectCornerRadii(radii: RectCornerRadii, delta: number): RectCornerRadii {
  return [
    offsetCornerRadius(radii[0], delta),
    offsetCornerRadius(radii[1], delta),
    offsetCornerRadius(radii[2], delta),
    offsetCornerRadius(radii[3], delta),
  ];
}

function offsetCornerRadius(radius: number, delta: number): number {
  if (radius <= 0) { return 0; }
  return Math.max(0, radius + delta);
}

function ellipsePoints(
  { cx, cy, rx, ry, segments }: { cx: number; cy: number; rx: number; ry: number; segments: number; }
): number[] {
  const points: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
  return points;
}

/**
 * Tessellate a ring (outer polygon minus inner polygon) into triangles.
 */
function tessellateRing(outer: number[], inner: number[]): Float32Array {
  const combined = [...outer, ...inner];
  const holeIndex = outer.length / 2;
  const indices = triangulate(combined, [holeIndex]);
  return indicesToVertices(combined, indices);
}

function indicesToVertices(coords: number[], indices: number[]): Float32Array {
  const vertices = new Float32Array(indices.length * 2);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    vertices[i * 2] = coords[idx * 2];
    vertices[i * 2 + 1] = coords[idx * 2 + 1];
  }
  return vertices;
}
