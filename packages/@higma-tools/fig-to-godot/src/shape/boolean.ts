/**
 * @file Compose a Figma `BOOLEAN_OPERATION` node into a single
 * concrete silhouette by running the operand children through the
 * vendored path-bool engine, then flattening the result back into
 * Polygon2D vertex arrays.
 *
 * Without this, `SUBTRACT` / `INTERSECT` / `EXCLUDE` operations would
 * fall back to the `UNION` approximation (paint every operand and let
 * over-paint approximate the merged silhouette) — only `UNION` looks
 * right that way; the others can be off by 7–22% pixel-diff.
 *
 * Pipeline:
 *
 *   1. Walk operand children and read their local-space PathCommand
 *      streams (from `fillGeometry[].commandsBlob` if present, else
 *      synthesise from primitive parameters).
 *   2. Apply each child's `transform` so every command lands in the
 *      BOOLEAN_OPERATION node's local coord space.
 *   3. Serialise to SVG `d`-strings and feed pairwise into
 *      `evaluateBooleanPaths` (the renderer's path-bool operation).
 *   4. Re-parse the resulting `d`-strings, flatten Bézier curves via
 *      `flattenPathCommands`, and pack into a single multi-contour
 *      `Contour` so `buildPolygon2DNodes` emits one Polygon2D with the
 *      `polygons` partition cutting holes correctly.
 */
import {
  decodePathCommands,
  type FigBlob,
} from "@higma-document-models/fig/domain";
import type { FigNode, FigMatrix } from "@higma-document-models/fig/types";
import { evaluateBooleanPathResult, type BooleanPathInput } from "@higma-primitives/path";
import { resolveBooleanOperationType } from "@higma-document-models/fig/boolean-operation";
import {
  parseSvgPathD,
  pathCommandsToSvgPath,
  transformPathCommands,
  type AffineMatrix,
  type PathCommand,
} from "@higma-primitives/path";
import {
  generateEllipseContour,
  generatePolygonContour,
  generateRectContour,
  generateStarContour,
} from "@higma-primitives/path/contours";
import { flattenPathCommands, type Contour } from "./path-flatten";
import { triangulateContoursWithHoles } from "./hole-triangulate";

/**
 * Try to compose a BOOLEAN_OPERATION node into a single multi-contour
 * silhouette. Returns `undefined` when:
 *
 *   - the walker has no doc-level blob array,
 *   - any operand has no decodable geometry, or
 *   - the path-bool engine rejects the input.
 *
 * The caller (`emitPathBlobLeaf`) falls back to `emitContainer` (UNION
 * approximation) when this returns `undefined`.
 */
export function composeBooleanContours(
  node_: FigNode,
  blobs: readonly FigBlob[] | undefined,
): readonly Contour[] | undefined {
  if (!blobs) {
    return undefined;
  }
  const op = aliasBooleanOperation(node_.booleanOperation);
  const childInputs = collectChildPathInputs(node_, blobs);
  if (childInputs.length === 0) {
    return undefined;
  }
  const result = evaluateBooleanPathResult(childInputs, op);
  if (!result.ok) {
    return undefined;
  }
  // Each result d-string is one contour group (a `M ... Z` cycle may
  // contain multiple subpaths if the boolean engine emitted holes).
  // Flatten each through the same Bézier subdivider the rest of the
  // converter uses so output vertices are pixel-accurate.
  //
  // path-bool's XOR / EXCLUDE result for two disjoint operands is a
  // single figure-8 polyline — both regions traced as one closed
  // curve that re-visits a shared vertex at the join. Polygon2D
  // can't render figure-8 with the `polygon` array alone, so we
  // detect repeated vertices and split the contour at them. Each
  // resulting sub-contour goes into the partition as a separate
  // region.
  const contours: Contour[] = [];
  for (const d of result.paths) {
    const cmds = parseSvgPathD(d);
    if (cmds.length === 0) {
      continue;
    }
    for (const c of flattenPathCommands(cmds)) {
      for (const split of splitFigureEightContour(c)) {
        contours.push(split);
      }
    }
  }
  if (contours.length === 0) {
    return undefined;
  }
  // Multiple contours from path-bool may signal a hole topology
  // (INTERSECT-of-overlapping-rects yields a frame). Run the
  // containment + ring-strip triangulator so the merged result
  // carries a `partition` for fill. The triangulator also keeps
  // the original outlines (as `outlineOnly` contours) so a stroke
  // path can iterate the outer + inner rings separately.
  return triangulateContoursWithHoles(contours);
}

/**
 * Split a figure-8 contour into separate closed contours. path-bool
 * returns the symmetric difference of disjoint operands as a single
 * polyline that visits a shared vertex twice — Polygon2D can't
 * render that directly. We scan the points for duplicate
 * (non-consecutive) positions; when one is found, we cut the
 * contour at the second occurrence and recursively split the
 * remainder.
 *
 * Returns the input unchanged when no figure-8 split is needed.
 */
function splitFigureEightContour(contour: Contour): readonly Contour[] {
  const points = contour.points;
  if (points.length < 6) {
    return [contour];
  }
  // Look for a vertex that appears twice in `points`, with at least
  // 2 vertices between the occurrences (otherwise the polyline
  // is just closing on itself).
  for (let i = 0; i < points.length - 3; i += 1) {
    for (let j = i + 3; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) {
        const first = points.slice(i, j);
        const rest = [...points.slice(0, i), ...points.slice(j)];
        // Recurse — `rest` may itself contain another figure-8.
        const tail = rest.length >= 3 ? splitFigureEightContour({ points: rest }) : [];
        return [{ points: first }, ...tail];
      }
    }
  }
  return [contour];
}

/**
 * Resolve a Figma booleanOperation enum to one of the four canonical
 * names the renderer's path-bool operation accepts. Figma authors the
 * "Exclude" operation via the `XOR` enum value (symmetric difference)
 * — same semantic as `EXCLUDE` in the canonical naming. The renderer
 * package's `resolveBooleanOperationType` doesn't recognise the alias
 * and returns `UNION` (default), which is wrong: a UNION of two
 * overlapping squares fills both, but EXCLUDE should leave the
 * overlap empty.
 */
function aliasBooleanOperation(
  raw: { readonly value?: number; readonly name?: string } | undefined,
): "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE" {
  if (!raw) {
    return "UNION";
  }
  const name = typeof raw.name === "string" ? raw.name : undefined;
  if (name === "XOR" || name === "EXCLUDE") {
    return "EXCLUDE";
  }
  return resolveBooleanOperationType(raw as never);
}

function collectChildPathInputs(
  node_: FigNode,
  blobs: readonly FigBlob[],
): BooleanPathInput[] {
  const out: BooleanPathInput[] = [];
  for (const child of node_.children ?? []) {
    if (!child) {
      continue;
    }
    if (child.visible === false) {
      continue;
    }
    if (child.type.name === "BOOLEAN_OPERATION") {
      // Recursively evaluate the inner op and concatenate result
      // d-strings into our input list, transformed by the child's
      // own transform so they land in the parent node's coord space.
      const innerOp = aliasBooleanOperation(child.booleanOperation);
      const innerInputs = collectChildPathInputs(child, blobs);
      if (innerInputs.length === 0) {
        continue;
      }
      const innerResult = evaluateBooleanPathResult(innerInputs, innerOp);
      if (!innerResult.ok) {
        continue;
      }
      for (const d of innerResult.paths) {
        const cmds = parseSvgPathD(d);
        const transformed = transformPathCommands(cmds, toAffineMatrix(child.transform));
        const transformedD = pathCommandsToSvgD(transformed);
        if (transformedD.length > 0) {
          out.push({ d: transformedD, windingRule: "nonzero" });
        }
      }
      continue;
    }
    const commands = childCommands(child, blobs);
    if (commands.length === 0) {
      continue;
    }
    const transformed = transformPathCommands(commands, toAffineMatrix(child.transform));
    const d = pathCommandsToSvgD(transformed);
    if (d.length === 0) {
      continue;
    }
    out.push({ d, windingRule: "nonzero" });
  }
  return out;
}

function childCommands(child: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const fromBlob = readBlobCommands(child, blobs);
  if (fromBlob.length > 0) {
    return fromBlob;
  }
  const fromPrim = synthesisePrimitiveCommands(child);
  return fromPrim ?? [];
}

function readBlobCommands(child: FigNode, blobs: readonly FigBlob[]): readonly PathCommand[] {
  const out: PathCommand[] = [];
  for (const geom of child.fillGeometry ?? []) {
    if (geom.commandsBlob === undefined) {
      continue;
    }
    if (geom.commandsBlob >= blobs.length) {
      continue;
    }
    const blob = blobs[geom.commandsBlob];
    if (!blob) {
      continue;
    }
    for (const cmd of decodePathCommands(blob)) {
      out.push(cmd);
    }
  }
  return out;
}

function synthesisePrimitiveCommands(node_: FigNode): readonly PathCommand[] | undefined {
  if (!node_.size) {
    return undefined;
  }
  const w = node_.size.x;
  const h = node_.size.y;
  switch (node_.type.name) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE": {
      const r = pickUniformCornerRadius(node_);
      // CornerRadius is `number | [tl, tr, br, bl]` in the renderers
      // package — pass the uniform radius directly as a scalar.
      const contour = generateRectContour(w, h, r);
      return contour.commands;
    }
    case "ELLIPSE":
      return generateEllipseContour(w, h).commands;
    case "STAR":
      return generateStarContour({
        width: w,
        height: h,
        pointCount: node_.pointCount ?? 5,
        // Mirror the renderer's builder preference order:
        // `starInnerScale` (newer) ≻ `starInnerRadius` (legacy) ≻
        // Figma's 0.382 default for a 5-point star.
        innerRadiusRatio: node_.starInnerScale ?? node_.starInnerRadius ?? 0.382,
      }).commands;
    case "REGULAR_POLYGON":
      return generatePolygonContour(w, h, node_.pointCount ?? 3).commands;
    default:
      return undefined;
  }
}

function pickUniformCornerRadius(node_: FigNode): number | undefined {
  if (typeof node_.cornerRadius === "number" && node_.cornerRadius > 0) {
    return node_.cornerRadius;
  }
  return undefined;
}

/**
 * Read a `FigMatrix` (every field optional) into the primitive's
 * `AffineMatrix` (every field required). The primitive lives at
 * layer 0 and must not depend on the fig domain, so field completion
 * happens at this call boundary.
 */
function toAffineMatrix(transform: FigMatrix | undefined): AffineMatrix | undefined {
  if (!transform) {
    return undefined;
  }
  return {
    m00: transform.m00 ?? 1,
    m01: transform.m01 ?? 0,
    m02: transform.m02 ?? 0,
    m10: transform.m10 ?? 0,
    m11: transform.m11 ?? 1,
    m12: transform.m12 ?? 0,
  };
}

/**
 * Serialise a PathCommand list as an SVG path `d` attribute for the
 * path-bool engine. Uses 6-decimal precision with a single space
 * separator — the format the boolean engine expects from this
 * pipeline.
 */
function pathCommandsToSvgD(commands: readonly PathCommand[]): string {
  return pathCommandsToSvgPath(commands, { precision: 6, separator: " " });
}
