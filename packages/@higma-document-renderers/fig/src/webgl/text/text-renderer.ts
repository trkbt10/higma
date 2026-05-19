/**
 * @file WebGL text rendering
 *
 * Renders text by tessellating glyph outline paths from the scene graph.
 * Glyph outlines come from either:
 * 1. Derived path data (pre-computed in .fig files) - exact match
 * 2. OpenType.js font outlines - high quality
 */

import type { TextNode, Color, PathContour, BlendMode } from "@higma-document-renderers/fig/scene-graph";
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
 * One painter's-algorithm pass over the glyph mesh. The SVG renderer
 * emits one `<path>` per stacked text fill; the WebGL caller mirrors
 * that by issuing one tinted draw per entry, in source order
 * (`fills[0]` painted first, `fills[n-1]` painted last).
 */
export type TessellatedTextFill = {
  readonly color: Color;
  readonly opacity: number;
  /**
   * Per-pass blend mode (scene-graph CSS-token form). `undefined`
   * denotes the implicit NORMAL pass — the GL backend skips any
   * blend-equation switch in that case. Mirrors the SVG emitter's
   * `style="mix-blend-mode:…"` so stacked fills with non-NORMAL
   * blends (App Store template Event metadata: `[{black @0.15
   * NORMAL}, {black @1 OVERLAY}]`) composite identically to Figma.
   */
  readonly blendMode?: BlendMode;
};

/**
 * Result of text tessellation.
 *
 * The glyph and decoration meshes are tessellated ONCE — every
 * stacked fill paints the same triangles. The `fills` array carries
 * each pass's tint and opacity so the WebGL backend can submit one
 * draw per entry without re-tessellating.
 */
export type TessellatedText = {
  /** Triangle vertices for glyph outlines (shared across every fill). */
  readonly glyphVertices: Float32Array;
  /** Triangle vertices for decorations (shared across every fill). */
  readonly decorationVertices: Float32Array;
  /**
   * Stacked fills in source order — paint the same mesh once per
   * entry, applying that entry's `color`/`opacity`. Mirrors the SVG
   * emitter, which writes one `<path fill="..." fill-opacity="...">`
   * per stacked paint so the painter's-algorithm composite matches
   * Figma's compositor (e.g. App Store template's Event metadata
   * Dark variant carries `[{black, opacity=0.15}, {black, opacity=1}]`
   * and the second pass darkens the first into solid black).
   *
   * Empty when the TEXT node carries no visible fills — callers
   * should skip drawing entirely.
   */
  readonly fills: readonly TessellatedTextFill[];
};

/**
 * Tessellate a text node's glyph outlines into triangle vertices
 * and surface every stacked fill so the WebGL backend can replicate
 * the SVG renderer's painter's-algorithm composite verbatim.
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
  // regression on real fig fixtures.
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

  const fills: TessellatedTextFill[] = node.fills.map((f) => ({
    color: f.color,
    opacity: f.opacity,
    ...(f.blendMode === undefined ? {} : { blendMode: f.blendMode }),
  }));
  return {
    glyphVertices,
    decorationVertices,
    fills,
  };
}
