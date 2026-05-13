/**
 * @file WebGL text rendering
 *
 * Renders text by tessellating glyph outline paths from the scene graph.
 * Glyph outlines come from either:
 * 1. Derived path data (pre-computed in .fig files) - exact match
 * 2. OpenType.js font outlines - high quality
 */

import type { TextNode, Color, PathContour } from "@higma-document-models/fig/scene-graph";
import { tessellateContours } from "../tessellation/tessellation";
import { splitPathCommandsIntoContours } from "../tessellation/path-contours";

/** Tessellate decoration contours or return empty array if none */
function tessellateDecorationsOrEmpty(
  contours: readonly PathContour[] | undefined,
  tolerance: number
): Float32Array {
  if (contours) {
    return tessellateContours(contours, tolerance, true);
  }
  return new Float32Array(0);
}

/**
 * Result of text tessellation
 */
export type TessellatedText = {
  /** Triangle vertices for glyph outlines */
  readonly glyphVertices: Float32Array;
  /** Triangle vertices for decorations (underlines, etc.) */
  readonly decorationVertices: Float32Array;
  /** Fill color */
  readonly color: Color;
  /** Fill opacity */
  readonly opacity: number;
};

/**
 * Tessellate a text node's glyph outlines into triangle vertices
 *
 * @param node - Scene graph text node
 * @param tolerance - Bezier flattening tolerance
 * @returns Tessellated text data
 */
export function tessellateTextNode(
  node: TextNode,
  tolerance: number = 0.25
): TessellatedText {
  if (!node.glyphContours || node.glyphContours.length === 0) {
    throw new Error(`WebGL text tessellation requires glyph contours for text node ${node.id}`);
  }

  // Split each glyph's commands into per-subpath contours before
  // tessellation. opentype.js (and Figma's derived glyph blobs) emit a
  // single PathCommand[] per glyph that bundles every subpath — for
  // glyphs like `0`, `9`, `B`, `D`, `P`, `R`, `₱`, the outer ring and
  // every interior hole share one commands array. The tessellator
  // classifies each `PathContour` as outer-or-hole by its signed area
  // and groups holes inside their containing outer, so the input must
  // be one contour per subpath. Without this split a "0" arrives as a
  // single boundary whose flattened coordinates jump between the
  // outer ring and the inner hole; earcut then weaves triangles
  // across the gap, the outer fill drops out, and only the hole's
  // interior rasterises — the "₱ 900.00 shows only the holes of 0"
  // regression on real fig fixtures. The split preserves
  // `firstCharacter` so the per-run grouping in
  // `resolveRenderTextGlyphRuns` still works (the WebGL renderer
  // currently consumes only the combined vertex buffer here, but
  // future per-run paint support relies on the annotation).
  const splitGlyphContours: PathContour[] = [];
  for (const glyph of node.glyphContours) {
    const subContours = splitPathCommandsIntoContours(glyph.commands, glyph.windingRule);
    for (const sub of subContours) {
      splitGlyphContours.push({
        commands: sub.commands,
        windingRule: glyph.windingRule,
      });
    }
  }
  // Figma glyph blobs use PostScript/CFF winding convention (invertWinding=true)
  const glyphVertices = tessellateContours(splitGlyphContours, tolerance, true);
  const decorationVertices = tessellateDecorationsOrEmpty(node.decorationContours, tolerance);

  return {
    glyphVertices,
    decorationVertices,
    color: node.fill.color,
    opacity: node.fill.opacity,
  };
}
