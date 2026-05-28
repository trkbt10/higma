/**
 * @file Auto-generate `fillGeometry` blob bytes for shape NodeSpecs.
 *
 * Figma's renderer treats `fillGeometry` as load-bearing on the
 * `.fig` import path — a RECTANGLE / ELLIPSE / STAR / POLYGON node
 * with no commandsBlob shows up as an empty frame in Figma's
 * editor (the node exists structurally but paints nothing).
 *
 * Real Figma exports always include a fillGeometry Blob whose
 * binary encodes the resolved path commands at the node's authored
 * size. This module mirrors that contract on the builder side:
 * given a `NodeSpec` that maps to a basic shape type, it produces
 * the matching blob bytes via the SoT encoders in
 * `@higma-document-models/fig/node-factory`. The caller (`addNode`)
 * registers the blob and patches the node's `fillGeometry` to point
 * at the resulting blob index.
 *
 * Supported types: RECTANGLE, ROUNDED_RECTANGLE, ELLIPSE, STAR,
 * REGULAR_POLYGON, LINE. VECTOR carries author-provided `vectorPaths`
 * which the renderer reads instead of `fillGeometry`, so no blob is
 * synthesised here.
 */

import {
  encodeEllipseBlob,
  encodeRectangleBlob,
  encodeRoundedRectangleBlob,
  encodeSvgPathBlob,
} from "@higma-document-models/fig/node-factory";
import {
  contourToSvgD,
  generateLineContour,
  generatePolygonContour,
  generateStarContour,
} from "@higma-primitives/path";
import type { NodeSpec } from "../types/spec-types";

function resolveCornerRadii(spec: NodeSpec): readonly [number, number, number, number] | undefined {
  if (spec.type !== "ROUNDED_RECTANGLE" && spec.type !== "FRAME") {
    return undefined;
  }
  if (spec.rectangleCornerRadii !== undefined) {
    return spec.rectangleCornerRadii;
  }
  if (spec.cornerRadius !== undefined && spec.cornerRadius > 0) {
    const r = spec.cornerRadius;
    return [r, r, r, r];
  }
  return undefined;
}

/**
 * Produce the fillGeometry blob bytes for a shape spec. Returns
 * `undefined` for node types that do not have an auto-encoded shape
 * (FRAME, GROUP, SECTION, SYMBOL, INSTANCE, BOOLEAN_OPERATION, TEXT,
 * VECTOR — the last carries its own `vectorPaths` array).
 */
export function autoFillGeometryBytes(spec: NodeSpec): Uint8Array | undefined {
  switch (spec.type) {
    case "RECTANGLE":
      return Uint8Array.from(encodeRectangleBlob(spec.width, spec.height));
    case "ROUNDED_RECTANGLE": {
      const radii = resolveCornerRadii(spec);
      if (radii === undefined) {
        return Uint8Array.from(encodeRectangleBlob(spec.width, spec.height));
      }
      // `encodeRoundedRectangleBlob` accepts a single uniform radius
      // (the schema-backed blob format encodes one value for all
      // four corners). When the spec authored per-corner radii, use
      // the maximum — Figma's renderer applies it as the conservative
      // outer envelope; the per-corner detail lives on the node's
      // own `rectangleCornerRadii` field which the renderer reads
      // independently of the blob.
      const uniformRadius = Math.max(...radii);
      return Uint8Array.from(encodeRoundedRectangleBlob(spec.width, spec.height, uniformRadius));
    }
    case "ELLIPSE":
      return Uint8Array.from(encodeEllipseBlob(spec.width, spec.height));
    case "STAR": {
      const d = contourToSvgD(
        generateStarContour({
          width: spec.width,
          height: spec.height,
          pointCount: spec.pointCount ?? 5,
          innerRadiusRatio: spec.starInnerRadius ?? 0.382,
        }),
      );
      return Uint8Array.from(encodeSvgPathBlob(d).bytes);
    }
    case "REGULAR_POLYGON": {
      const d = contourToSvgD(generatePolygonContour(spec.width, spec.height, spec.pointCount ?? 3));
      return Uint8Array.from(encodeSvgPathBlob(d).bytes);
    }
    case "LINE": {
      const d = contourToSvgD(generateLineContour(spec.width));
      return Uint8Array.from(encodeSvgPathBlob(d).bytes);
    }
    default:
      return undefined;
  }
}

/**
 * Whether the shape spec describes a closed-contour fill. Used by
 * the caller to populate `fillGeometry[].windingRule` — closed
 * shapes use `NONZERO`; the open `LINE` contour has no fill region
 * (its blob lives in `strokeGeometry` instead).
 */
export function specProducesFill(spec: NodeSpec): boolean {
  return (
    spec.type === "RECTANGLE"
    || spec.type === "ROUNDED_RECTANGLE"
    || spec.type === "ELLIPSE"
    || spec.type === "STAR"
    || spec.type === "REGULAR_POLYGON"
  );
}

/**
 * Whether the shape spec describes a path that lives in
 * `strokeGeometry` rather than `fillGeometry`. Currently only LINE
 * — LINE has zero height and no fill region, so its commandsBlob
 * goes under `strokeGeometry[0]` on Figma's wire format.
 */
export function specProducesStroke(spec: NodeSpec): boolean {
  return spec.type === "LINE";
}

/**
 * Use an existing per-spec generated `ellipse arc data` SVG path
 * when present (semicircles, donut rings). Otherwise fall back to
 * the basic full-ellipse contour. The arc data lives on the node
 * itself (`arcData.startingAngle`, `arcData.endingAngle`,
 * `arcData.innerRadius`) and is patched in by callers via
 * `updateNode` — at spec time those values aren't surfaced, so
 * arc shapes still fall through to `encodeEllipseBlob` and the
 * arc clip is applied at render time.
 *
 * (Kept as a doc anchor — the actual selection happens inside
 * `autoFillGeometryBytes`.)
 */
