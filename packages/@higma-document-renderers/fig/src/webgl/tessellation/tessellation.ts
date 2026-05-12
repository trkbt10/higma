/**
 * @file Path tessellation for WebGL rendering
 *
 * Converts bezier paths into triangle meshes for GPU rendering.
 * Uses earcut for polygon triangulation after flattening curves to polylines.
 *
 * Path flattening / arc → cubic helpers live in
 * `@higma-primitives/path`. This file keeps only the renderer-specific
 * triangulation and vertex-buffer assembly logic.
 *
 * The custom `no-cross-package-reexport` rule forbids republishing
 * `flattenPathCommands` through this module, so consumers import the
 * primitive directly. Inside this module the local-file path
 * flattening usage stays in scope.
 */

import earcut from "earcut";
import { flattenPathCommands } from "@higma-primitives/path";
import type { CornerRadius, PathContour } from "../../scene-graph/types";

// =============================================================================
// Earcut Integration
// =============================================================================

/**
 * Triangulate a polygon with optional holes using earcut
 *
 * @param coords - Flat array of coordinates [x0, y0, x1, y1, ...]
 * @param holeIndices - Indices into coords/2 where each hole starts
 * @returns Array of triangle vertex indices
 */
export function triangulate(
  coords: readonly number[],
  holeIndices?: readonly number[]
): number[] {
  const n = coords.length >> 1;
  if (n < 3) {return [];}

  return earcut(coords as number[], holeIndices as number[] | undefined, 2);
}

// =============================================================================
// Contour Tessellation
// =============================================================================

/**
 * Compute signed area of a polygon from flat coordinates.
 * Positive = counter-clockwise, negative = clockwise.
 */
function signedArea(coords: readonly number[]): number {
  const n = coords.length >> 1;
  const areaRef = { value: 0 };
  for (let i = 0, j = n - 1; i < n; j = i++) {
    areaRef.value += (coords[j * 2] - coords[i * 2]) * (coords[j * 2 + 1] + coords[i * 2 + 1]);
  }
  return areaRef.value;
}

/**
 * Tessellate a single path contour into triangles
 *
 * @param contour - Path contour to tessellate
 * @param tolerance - Bezier flattening tolerance
 * @returns Float32Array of triangle vertices [x0, y0, x1, y1, x2, y2, ...]
 */
export function tessellateContour(
  contour: PathContour,
  tolerance: number = 0.25
): Float32Array {
  const flatCoords = flattenPathCommands(contour.commands, tolerance);

  if (flatCoords.length < 6) {
    return new Float32Array(0);
  }

  const indices = triangulate(flatCoords);

  // Convert indices to vertex positions
  const vertices = new Float32Array(indices.length * 2);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    vertices[i * 2] = flatCoords[idx * 2];
    vertices[i * 2 + 1] = flatCoords[idx * 2 + 1];
  }

  return vertices;
}

/**
 * Tessellate multiple contours into a single vertex buffer.
 *
 * Groups outer contours with their holes for correct triangulation.
 * Outer contours are clockwise (negative signed area), holes are CCW (positive).
 * For glyphs like 'O', the outer ring and inner hole are combined so the hole
 * is properly subtracted.
 *
 * @param contours - Path contours to tessellate
 * @param tolerance - Bezier flattening tolerance (default 0.25)
 * @param autoDetectWinding - When true, auto-detects the outer/hole winding
 *   convention by majority vote. Necessary for font glyph data where different
 *   fonts may use TrueType (CW=outer) or PostScript/CFF (CCW=outer) conventions.
 */

type FlatContour = { coords: number[]; area: number };

/** Determine whether outer contours have negative signed area */
function resolveOuterIsNegative(autoDetectWinding: boolean, flatContours: FlatContour[]): boolean {
  if (!autoDetectWinding) {
    return true; // default: TrueType convention
  }
  const negativeCountRef = { value: 0 };
  const positiveCountRef = { value: 0 };
  for (const fc of flatContours) {
    if (fc.area < 0) {negativeCountRef.value++;}
    else if (fc.area > 0) {positiveCountRef.value++;}
  }
  return negativeCountRef.value >= positiveCountRef.value;
}

/**
 * Tessellate path contours into triangles for WebGL rendering.
 *
 * Groups outer contours with their holes for correct triangulation.
 */
export function tessellateContours(
  contours: readonly PathContour[],
  tolerance: number = 0.25,
  autoDetectWinding: boolean = false
): Float32Array {
  if (contours.length === 0) {return new Float32Array(0);}

  // Flatten all contours and compute signed areas
  const flatContours: FlatContour[] = [];
  for (const contour of contours) {
    const coords = flattenPathCommands(contour.commands, tolerance);
    if (coords.length < 6) {continue;}
    flatContours.push({ coords, area: signedArea(coords) });
  }

  if (flatContours.length === 0) {return new Float32Array(0);}

  // Determine which sign represents "outer" contours
  // Default: negative signed area = outer (TrueType CW convention)
  // When autoDetectWinding: use majority sign to detect the convention.
  // The majority of contours in text are outers (simple glyphs without holes),
  // so the dominant sign indicates the outer convention.
  const outerIsNegative = resolveOuterIsNegative(autoDetectWinding, flatContours);

  // Classify as outer / hole and compute bounding boxes
  type ClassifiedContour = {
    coords: number[];
    isHole: boolean;
    absArea: number;
    minX: number; minY: number; maxX: number; maxY: number;
  };
  const classifiedContours: ClassifiedContour[] = flatContours.map((fc) => {
    const boundsRef = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < fc.coords.length; i += 2) {
      const x = fc.coords[i], y = fc.coords[i + 1];
      if (x < boundsRef.minX) {boundsRef.minX = x;}
      if (x > boundsRef.maxX) {boundsRef.maxX = x;}
      if (y < boundsRef.minY) {boundsRef.minY = y;}
      if (y > boundsRef.maxY) {boundsRef.maxY = y;}
    }
    return {
      coords: fc.coords,
      isHole: outerIsNegative ? fc.area > 0 : fc.area < 0,
      absArea: Math.abs(fc.area),
      minX: boundsRef.minX, minY: boundsRef.minY, maxX: boundsRef.maxX, maxY: boundsRef.maxY,
    };
  });

  // Separate outers and holes, sort outers by area (largest first)
  const outers = classifiedContours.filter((c) => !c.isHole);
  const holes = classifiedContours.filter((c) => c.isHole);
  outers.sort((a, b) => b.absArea - a.absArea);

  // Group: assign each hole to the smallest outer whose bbox contains it
  type ContourGroup = { outer: number[]; holes: number[][] };
  const groups: ContourGroup[] = outers.map((o) => ({ outer: o.coords, holes: [] }));

  for (const hole of holes) {
    // Find the smallest containing outer by bounding box
    const bestIdxRef = { value: -1 };
    const bestAreaRef = { value: Infinity };
    const hCx = (hole.minX + hole.maxX) / 2;
    const hCy = (hole.minY + hole.maxY) / 2;
    for (let i = 0; i < outers.length; i++) {
      const o = outers[i];
      if (hCx >= o.minX && hCx <= o.maxX && hCy >= o.minY && hCy <= o.maxY) {
        if (o.absArea < bestAreaRef.value) {
          bestAreaRef.value = o.absArea;
          bestIdxRef.value = i;
        }
      }
    }
    if (bestIdxRef.value >= 0) {
      groups[bestIdxRef.value].holes.push(hole.coords);
    }
    // Holes not contained by any outer are dropped
  }

  // Tessellate each group
  const allVertices: Float32Array[] = [];
  const totalLengthRef = { value: 0 };

  for (const group of groups) {
    const combined: number[] = [...group.outer];
    const holeIndices: number[] = [];

    for (const hole of group.holes) {
      holeIndices.push(combined.length / 2);
      combined.push(...hole);
    }

    const indices = triangulate(combined, holeIndices.length > 0 ? holeIndices : undefined);

    const vertices = new Float32Array(indices.length * 2);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      vertices[i * 2] = combined[idx * 2];
      vertices[i * 2 + 1] = combined[idx * 2 + 1];
    }

    allVertices.push(vertices);
    totalLengthRef.value += vertices.length;
  }

  const result = new Float32Array(totalLengthRef.value);
  const offsetRef = { value: 0 };
  for (const vertices of allVertices) {
    result.set(vertices, offsetRef.value);
    offsetRef.value += vertices.length;
  }

  return result;
}

// =============================================================================
// Geometry Generators
// =============================================================================

/**
 * Generate rectangle vertices (2 triangles)
 */
export function generateRectVertices(
  width: number,
  height: number,
  cornerRadius?: CornerRadius
): Float32Array {
  const radii = normalizeCornerRadii({ width, height, cornerRadius });
  if (radii.every((r) => r <= 0)) {
    // Simple rectangle: 2 triangles
    return new Float32Array([
      0, 0, width, 0, width, height,
      0, 0, width, height, 0, height,
    ]);
  }

  const points = roundedRectFillPoints({ width, height, radii, segments: 8 });

  const indices = triangulate(points);
  const vertices = new Float32Array(indices.length * 2);
  for (let i = 0; i < indices.length; i++) {
    vertices[i * 2] = points[indices[i] * 2];
    vertices[i * 2 + 1] = points[indices[i] * 2 + 1];
  }

  return vertices;
}

function normalizeCornerRadii(
  { width, height, cornerRadius }: { width: number; height: number; cornerRadius?: CornerRadius },
): readonly [number, number, number, number] {
  const maxRadius = Math.min(width / 2, height / 2);
  if (cornerRadius === undefined) {
    return [0, 0, 0, 0];
  }
  if (typeof cornerRadius === "number") {
    const radius = Math.max(0, Math.min(cornerRadius, maxRadius));
    return [radius, radius, radius, radius];
  }
  return [
    Math.max(0, Math.min(cornerRadius[0], maxRadius)),
    Math.max(0, Math.min(cornerRadius[1], maxRadius)),
    Math.max(0, Math.min(cornerRadius[2], maxRadius)),
    Math.max(0, Math.min(cornerRadius[3], maxRadius)),
  ];
}

function pushRoundedCornerPoints(
  { points, cx, cy, radius, startAngle, endAngle, segments }: {
    points: number[];
    cx: number;
    cy: number;
    radius: number;
    startAngle: number;
    endAngle: number;
    segments: number;
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

function roundedRectFillPoints(
  { width, height, radii, segments }: {
    width: number;
    height: number;
    radii: readonly [number, number, number, number];
    segments: number;
  },
): number[] {
  const [tl, tr, br, bl] = radii;
  const points: number[] = [];

  pushRoundedCornerPoints({
    points,
    cx: width - tr,
    cy: tr,
    radius: tr,
    startAngle: -Math.PI / 2,
    endAngle: 0,
    segments,
  });
  pushRoundedCornerPoints({
    points,
    cx: width - br,
    cy: height - br,
    radius: br,
    startAngle: 0,
    endAngle: Math.PI / 2,
    segments,
  });
  pushRoundedCornerPoints({
    points,
    cx: bl,
    cy: height - bl,
    radius: bl,
    startAngle: Math.PI / 2,
    endAngle: Math.PI,
    segments,
  });
  pushRoundedCornerPoints({
    points,
    cx: tl,
    cy: tl,
    radius: tl,
    startAngle: Math.PI,
    endAngle: Math.PI * 1.5,
    segments,
  });

  return points;
}

/** Parameters for generating ellipse vertices */
type EllipseVerticesParams = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  segments?: number;
};

/**
 * Generate ellipse vertices (triangle fan)
 */
export function generateEllipseVertices(
  { cx, cy, rx, ry, segments = 64 }: EllipseVerticesParams
): Float32Array {
  // Triangle fan from center
  const vertices = new Float32Array(segments * 6);

  for (let i = 0; i < segments; i++) {
    const a0 = (2 * Math.PI * i) / segments;
    const a1 = (2 * Math.PI * (i + 1)) / segments;

    const idx = i * 6;
    vertices[idx] = cx;
    vertices[idx + 1] = cy;
    vertices[idx + 2] = cx + rx * Math.cos(a0);
    vertices[idx + 3] = cy + ry * Math.sin(a0);
    vertices[idx + 4] = cx + rx * Math.cos(a1);
    vertices[idx + 5] = cy + ry * Math.sin(a1);
  }

  return vertices;
}
