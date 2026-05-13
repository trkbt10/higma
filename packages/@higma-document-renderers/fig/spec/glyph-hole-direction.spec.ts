/**
 * @file WebGL glyph hole-tessellation visual regression.
 *
 * Drives `tessellateTextNode` against a synthesised multi-subpath
 * glyph that mimics the failing real-world inputs (Figma's derived
 * blobs for digits and the Philippine peso sign). Rasterises the
 * resulting triangle fan via resvg and probes pixels: the outer
 * ring band must be filled and the hole interior must remain
 * empty. Catches the E-Commerce "₱ 900.00 displays only the holes
 * of 0s" regression at the pixel level even if a future refactor
 * keeps the unit-level area sums intact while breaking the
 * end-to-end rasterisation.
 */

import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import type { PathContour, TextNode } from "@higma-document-models/fig/scene-graph";
import { tessellateTextNode } from "../src/webgl/text/text-renderer";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as const;

// Helpers — borrow the same handedness convention used by
// `webgl/text/text-tessellation.spec.ts`: visually-CCW polygons
// have NEGATIVE signed area under the trapezoidal formula and are
// the "outer" convention.
function outerRect(p: { x: number; y: number; w: number; h: number }): PathContour {
  return {
    commands: [
      { type: "M", x: p.x, y: p.y + p.h },
      { type: "L", x: p.x + p.w, y: p.y + p.h },
      { type: "L", x: p.x + p.w, y: p.y },
      { type: "L", x: p.x, y: p.y },
      { type: "Z" },
    ],
    windingRule: "nonzero",
  };
}
function holeRect(p: { x: number; y: number; w: number; h: number }): PathContour {
  return {
    commands: [
      { type: "M", x: p.x, y: p.y },
      { type: "L", x: p.x + p.w, y: p.y },
      { type: "L", x: p.x + p.w, y: p.y + p.h },
      { type: "L", x: p.x, y: p.y + p.h },
      { type: "Z" },
    ],
    windingRule: "nonzero",
  };
}

function makeTextNode(glyphContours: readonly (PathContour & { firstCharacter: number })[]): TextNode {
  return {
    type: "text",
    id: "test-text" as TextNode["id"],
    name: "Test Text",
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    width: 40,
    height: 20,
    textAutoResize: "WIDTH_AND_HEIGHT",
    runs: [{ start: 0, end: 0, fillColor: "#000000", fillOpacity: 1 }],
    fill: { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 },
    glyphContours,
  };
}

function vertsToSvg(verts: Float32Array, opts: { width: number; height: number; bbox: { x: number; y: number; w: number; h: number } }): string {
  const pad = 1;
  const scale = Math.min(
    (opts.width - pad * 2) / opts.bbox.w,
    (opts.height - pad * 2) / opts.bbox.h,
  );
  const tx = (x: number): number => pad + (x - opts.bbox.x) * scale;
  const ty = (y: number): number => pad + (y - opts.bbox.y) * scale;
  const tri: string[] = [];
  for (let i = 0; i < verts.length; i += 6) {
    tri.push(
      `<polygon points="${tx(verts[i]).toFixed(2)},${ty(verts[i + 1]).toFixed(2)} ${tx(verts[i + 2]).toFixed(2)},${ty(verts[i + 3]).toFixed(2)} ${tx(verts[i + 4]).toFixed(2)},${ty(verts[i + 5]).toFixed(2)}" fill="black"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}"><rect width="${opts.width}" height="${opts.height}" fill="white"/>${tri.join("")}</svg>`;
}

function rasterise(svg: string): { readonly pixels: Buffer; readonly width: number } {
  const resvg = new Resvg(svg, { shapeRendering: 0, fitTo: { mode: "original" } });
  const png = resvg.render();
  return { pixels: png.pixels, width: png.width };
}

function pixelLuma(pixels: Buffer, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
}

describe("WebGL glyph-hole rasterisation (visual regression)", () => {
  // A single glyph that bundles outer ring + interior hole in ONE
  // PathCommand[] (the exact shape opentype.js and Figma's derived
  // blobs emit). Earlier the WebGL tessellator treated this as one
  // boundary, wove triangles across the gap, and rasterised a solid
  // blob. The fix splits subpaths and area-weights the winding
  // detection; together they produce a proper ring.
  it("'0'-like glyph (1 outer + 1 hole bundled) rasterises as a ring with empty centre", () => {
    const glyph: PathContour & { firstCharacter: number } = {
      commands: [
        ...outerRect({ x: 0, y: 0, w: 20, h: 20 }).commands,
        ...holeRect({ x: 6, y: 6, w: 8, h: 8 }).commands,
      ],
      windingRule: "nonzero",
      firstCharacter: 0,
    };
    const tess = tessellateTextNode(makeTextNode([glyph]));
    expect(tess.glyphVertices.length).toBeGreaterThan(0);
    const svg = vertsToSvg(tess.glyphVertices, { width: 200, height: 200, bbox: { x: 0, y: 0, w: 20, h: 20 } });
    const { pixels, width } = rasterise(svg);

    // Hole interior centre → must be untouched (white).
    const holeCentre = pixelLuma(pixels, width, 100, 100);
    expect(holeCentre).toBeGreaterThan(240);

    // Outer ring corner cells → filled (dark).
    const ringTopLeft = pixelLuma(pixels, width, 25, 25);
    const ringTopRight = pixelLuma(pixels, width, 175, 25);
    const ringBottomLeft = pixelLuma(pixels, width, 25, 175);
    const ringBottomRight = pixelLuma(pixels, width, 175, 175);
    expect(ringTopLeft).toBeLessThan(64);
    expect(ringTopRight).toBeLessThan(64);
    expect(ringBottomLeft).toBeLessThan(64);
    expect(ringBottomRight).toBeLessThan(64);
  });

  // The peso-shape regression: a hole-heavy glyph (1 outer + 3
  // holes) PAIRED with a normal "0" (1 outer + 1 hole) skews the
  // global count to 4 holes vs 2 outers. Earlier the count-based
  // detection flipped the convention and rasterised both digits as
  // empty / inverted blobs. The area-weighted detection must
  // preserve the outer ring of the "0" intact.
  it("hole-heavy peso glyph alongside a '0' keeps the '0' rasterising as a ring", () => {
    const peso: PathContour & { firstCharacter: number } = {
      commands: [
        ...outerRect({ x: 0, y: 0, w: 20, h: 20 }).commands,
        ...holeRect({ x: 4, y: 4, w: 12, h: 5 }).commands,
        ...holeRect({ x: 2, y: 11, w: 16, h: 1 }).commands,
        ...holeRect({ x: 2, y: 14, w: 16, h: 1 }).commands,
      ],
      windingRule: "nonzero",
      firstCharacter: 0,
    };
    const zero: PathContour & { firstCharacter: number } = {
      commands: [
        ...outerRect({ x: 30, y: 0, w: 20, h: 20 }).commands,
        ...holeRect({ x: 36, y: 6, w: 8, h: 8 }).commands,
      ],
      windingRule: "nonzero",
      firstCharacter: 1,
    };
    const tess = tessellateTextNode(makeTextNode([peso, zero]));
    expect(tess.glyphVertices.length).toBeGreaterThan(0);
    const svg = vertsToSvg(tess.glyphVertices, {
      width: 500,
      height: 200,
      bbox: { x: 0, y: 0, w: 50, h: 20 },
    });
    const { pixels, width } = rasterise(svg);

    // '0' is positioned at world (30..50, 0..20). With width 500,
    // bbox 50 wide → scale = 10. So the '0' centre maps to
    // x ≈ pad + (40 − 0) * 10 = 401.
    const zeroHoleCentre = pixelLuma(pixels, width, 401, 100);
    expect(zeroHoleCentre).toBeGreaterThan(240); // hole stays empty

    const zeroRingTopLeft = pixelLuma(pixels, width, 315, 25);
    const zeroRingBottomRight = pixelLuma(pixels, width, 485, 175);
    expect(zeroRingTopLeft).toBeLessThan(64);
    expect(zeroRingBottomRight).toBeLessThan(64);
  });
});
