/**
 * @file Convert Figma geometry data to scene graph PathContours
 *
 * Winding rule mapping delegates to geometry/interpret.ts (the SoT).
 * The SVG path-`d` parser lives in `@higma-primitives/path`;
 * consumers import it directly from that package.
 */

import { decodePathCommands, type FigBlob } from "@higma-document-models/fig/domain";
import type { FigFillGeometry, FigVectorPath } from "@higma-document-models/fig/types";
import { parseSvgPathD } from "@higma-primitives/path";
import { mapWindingRule } from "../../geometry";
import type { PathContour } from "@higma-document-models/fig/scene-graph";

/**
 * Decoded contour with optional geometry-level styleID.
 * The styleID references vectorData.styleOverrideTable for per-path fill overrides.
 */
export type DecodedContour = PathContour & {
  readonly geometryStyleId?: number;
};

/**
 * Decode fill geometry blobs to PathContour arrays
 */
export function decodeGeometryToContours(
  fillGeometry: readonly FigFillGeometry[] | undefined,
  blobs: readonly FigBlob[],
): DecodedContour[] {
  if (!fillGeometry || fillGeometry.length === 0) {
    return [];
  }

  const contours: DecodedContour[] = [];

  for (const geom of fillGeometry) {
    const blobIndex = geom.commandsBlob;
    if (blobIndex === undefined || blobIndex >= blobs.length) {continue;}

    const blob = blobs[blobIndex];
    if (!blob) {continue;}

    const commands = decodePathCommands(blob);
    if (commands.length === 0) {continue;}

    const windingRule = mapWindingRule(geom.windingRule);

    contours.push({
      commands,
      windingRule,
      geometryStyleId: geom.styleID,
    });
  }

  return contours;
}

/**
 * Convert vectorPaths (pre-decoded SVG path strings) to PathContours
 */
export function convertVectorPathsToContours(
  vectorPaths: readonly FigVectorPath[] | undefined,
): DecodedContour[] {
  if (!vectorPaths || vectorPaths.length === 0) {
    return [];
  }

  return vectorPaths
    .filter((vp) => vp.data)
    .map((vp) => ({
      commands: parseSvgPathD(vp.data!),
      windingRule: mapWindingRule(vp.windingRule),
    }));
}
