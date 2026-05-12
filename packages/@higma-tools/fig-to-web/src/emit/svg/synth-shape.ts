/**
 * @file Synthesize SVG path data for parametric shapes.
 *
 * Some `.fig` exports (notably builder-generated documents and the
 * image-to-fig pipeline) omit `fillGeometry` blobs for star,
 * polygon, line, and arc-shaped ellipse nodes. The Figma renderer
 * synthesises the contour from primitives (`pointCount`,
 * `starInnerScale`, `arcData`, …); we delegate to the same helpers
 * so the React output reproduces the identical path the
 * authoritative SVG render produces.
 *
 * The helpers below are pure: they consume only the subset of
 * `FigNode` fields that drive geometry, so each shape type's path
 * can be unit-tested in isolation.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import {
  generateLineContour,
  generatePolygonContour,
  generateStarContour,
} from "@higma-primitives/path/contours";
import { contourToSvgD } from "@higma-document-renderers/fig/scene-graph";
import { buildEllipseArcPathD } from "@higma-document-renderers/fig/scene-graph/render-tree";

const DEFAULT_STAR_POINTS = 5;
const DEFAULT_STAR_INNER_RATIO = 0.382;
const DEFAULT_POLYGON_POINTS = 3;

/**
 * Build the synthetic SVG path string list for a parametric vector
 * node, or `undefined` if this node type cannot be synthesised
 * (vectors with `fillGeometry` blobs go through the geometry
 * decoder instead and never reach this function).
 */
export function synthesizeShapePath(node: FigNode): string | undefined {
  const w = node.size?.x;
  const h = node.size?.y;
  if (typeof w !== "number" || typeof h !== "number") {
    return undefined;
  }
  switch (node.type.name) {
    case "LINE":
      // Lines have a zero height by design — the stroke gives them
      // visible thickness — so we don't gate on `h > 0`.
      if (w <= 0) {
        return undefined;
      }
      return contourToSvgD(generateLineContour(w));
    case "REGULAR_POLYGON":
      if (w <= 0 || h <= 0) {
        return undefined;
      }
      return contourToSvgD(generatePolygonContour(w, h, polygonPointCount(node)));
    case "STAR":
      if (w <= 0 || h <= 0) {
        return undefined;
      }
      return contourToSvgD(
        generateStarContour({
          width: w,
          height: h,
          pointCount: starPointCount(node),
          innerRadiusRatio: starInnerRatio(node),
        }),
      );
    case "ELLIPSE":
      if (w <= 0 || h <= 0) {
        return undefined;
      }
      return ellipsePath(node, w, h);
    default:
      return undefined;
  }
}

function polygonPointCount(node: FigNode): number {
  const candidate = (node as { readonly pointCount?: number }).pointCount;
  if (typeof candidate === "number" && candidate >= 3) {
    return Math.floor(candidate);
  }
  return DEFAULT_POLYGON_POINTS;
}

function starPointCount(node: FigNode): number {
  const candidate = (node as { readonly pointCount?: number }).pointCount;
  if (typeof candidate === "number" && candidate >= 3) {
    return Math.floor(candidate);
  }
  return DEFAULT_STAR_POINTS;
}

function starInnerRatio(node: FigNode): number {
  const innerScale = (node as { readonly starInnerScale?: number }).starInnerScale;
  if (typeof innerScale === "number" && innerScale > 0 && innerScale < 1) {
    return innerScale;
  }
  const innerRadius = (node as { readonly starInnerRadius?: number }).starInnerRadius;
  if (typeof innerRadius === "number" && innerRadius > 0 && innerRadius < 1) {
    return innerRadius;
  }
  return DEFAULT_STAR_INNER_RATIO;
}

/**
 * Ellipse synthesis branches on `arcData`:
 *   - missing OR full-circle (sweep ≈ 2π, innerRadius 0): return
 *     `undefined`. A plain ellipse renders fine via CSS
 *     `border-radius: 50%` and the IMAGE / GRADIENT background path,
 *     so no SVG synthesis is needed. Treating a no-op arc as an arc
 *     would force a `<path>` render that drops IMAGE fills (SVG
 *     `<path fill="...">` cannot hold a CSS `background-image`).
 *   - partial sweep OR donut (innerRadius > 0): produce the
 *     explicit start/end-angle arc.
 */
function ellipsePath(node: FigNode, w: number, h: number): string | undefined {
  const arc = (node as { readonly arcData?: { readonly startingAngle: number; readonly endingAngle: number; readonly innerRadius: number } }).arcData;
  if (!arc) {
    return undefined;
  }
  if (isFullCircleArc(arc)) {
    return undefined;
  }
  const cx = w / 2;
  const cy = h / 2;
  return buildEllipseArcPathD(cx, cy, cx, cy, arc);
}

const FULL_CIRCLE_EPSILON = 1e-3;

function isFullCircleArc(arc: { readonly startingAngle: number; readonly endingAngle: number; readonly innerRadius: number }): boolean {
  if (arc.innerRadius && arc.innerRadius > 0) {
    return false;
  }
  const sweep = Math.abs(arc.endingAngle - arc.startingAngle);
  return Math.abs(sweep - 2 * Math.PI) < FULL_CIRCLE_EPSILON;
}

/**
 * True when this node can take advantage of the synthesis pathway —
 * used by the JSX emitter to decide whether to wrap the node in an
 * `<svg>` element even though no precomputed geometry blob exists.
 */
export function canSynthesizeShape(node: FigNode): boolean {
  switch (node.type.name) {
    case "REGULAR_POLYGON":
    case "STAR":
    case "LINE":
      return true;
    case "ELLIPSE":
      return Boolean((node as { readonly arcData?: unknown }).arcData);
    default:
      return false;
  }
}
