/**
 * @file Inner-shadow visual regression guard.
 *
 * Pixel-level proof that the SVG `INNER_SHADOW` recipe paints the
 * shadow band INSIDE the shape on the side OPPOSITE the offset,
 * matching the WebGL renderer's `shapeAlpha * (1 - blurredAlpha_at_offset)`
 * formula. The earlier recipe (`feFlood → feComposite(in,SourceAlpha)
 * → feOffset → feComposite(out,SourceAlpha)`) produced a band
 * OUTSIDE the original shape — the Win98 button only rendered a
 * thin slice at the wrong corner. This spec rasterises a tiny
 * single-shadow SVG and asserts pixel colour at four hand-picked
 * locations: the band cell on the correct (offset-opposite) corner
 * must be dark, the band cell on the wrong corner must be light,
 * and the shape interior must remain its fill colour.
 */

import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";

// Build the SVG the recipe is supposed to emit. The structural
// render-parity spec already verifies that `resolveEffects(...)`
// emits exactly these primitives — this spec verifies that those
// primitives, once formatted to SVG and rasterised, produce the
// expected pixels. Keeping the markup hand-written here means the
// guard fires if the recipe is *symbolically* unchanged but
// *semantically* wrong (e.g. somebody swaps `in`/`in2` on the band
// composite).
function buildInnerShadowSvg(opts: {
  readonly size: number;
  readonly dx: number;
  readonly dy: number;
  readonly shadowColor: string;
  readonly fill: string;
}): string {
  const pad = 4;
  const total = opts.size + pad * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">`,
    `<defs>`,
    `<filter id="ins" x="-${pad}" y="-${pad}" width="${total + pad}" height="${total + pad}" filterUnits="userSpaceOnUse">`,
    // Recipe (post-fix):
    //   feOffset SourceAlpha → off
    //   feGaussianBlur off → blur
    //   feComposite SourceAlpha OUT blur → band   (inside the shape, opposite of the offset)
    //   feFlood color → flood
    //   feComposite flood IN band → inner          (coloured band)
    //   feMerge SourceGraphic + inner              (band over shape)
    `<feOffset in="SourceAlpha" dx="${opts.dx}" dy="${opts.dy}" result="off"/>`,
    `<feGaussianBlur in="off" stdDeviation="0" result="blur"/>`,
    `<feComposite in="SourceAlpha" in2="blur" operator="out" result="band"/>`,
    `<feFlood flood-color="${opts.shadowColor}" flood-opacity="1" result="flood"/>`,
    `<feComposite in="flood" in2="band" operator="in" result="inner"/>`,
    `<feMerge>`,
    `<feMergeNode in="SourceGraphic"/>`,
    `<feMergeNode in="inner"/>`,
    `</feMerge>`,
    `</filter>`,
    `</defs>`,
    `<rect x="${pad}" y="${pad}" width="${opts.size}" height="${opts.size}" fill="${opts.fill}" filter="url(#ins)"/>`,
    `</svg>`,
  ].join("");
}

function rasterise(svg: string): { readonly pixels: Buffer; readonly width: number; readonly height: number } {
  const resvg = new Resvg(svg, {
    shapeRendering: 0, // crisp edges — keeps the 2-px band sharp at the rasterisation step
    textRendering: 0,
    fitTo: { mode: "original" },
  });
  const png = resvg.render();
  return { pixels: png.pixels, width: png.width, height: png.height };
}

function pixelLuminance(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
): number {
  // RGBA — return perceived luminance (0..255). Lower = darker.
  const i = (y * width + x) * 4;
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("INNER_SHADOW pixel direction (visual regression)", () => {
  // For offset(+2, +2) the band should sit on the TOP-LEFT inner edge —
  // this is the Win98 button's white-highlight direction. The earlier
  // recipe inverted this and the band escaped the shape entirely.
  it("offset (+2, +2) paints the band on the inner TOP-LEFT, not bottom-right or outside", () => {
    const svg = buildInnerShadowSvg({
      size: 20,
      dx: 2,
      dy: 2,
      shadowColor: "black",
      fill: "white",
    });
    const { pixels, width, height } = rasterise(svg);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Shape footprint runs (pad=4) → (4 + 20). Probe four cells.
    // Each value is luminance (0=black .. 255=white).
    const topLeftBand = pixelLuminance(pixels, width, 5, 5);
    const bottomRightBand = pixelLuminance(pixels, width, 22, 22);
    const interior = pixelLuminance(pixels, width, 12, 12);
    const outsideTopLeft = pixelLuminance(pixels, width, 1, 1);

    // Band lives on top-left INSIDE → dark.
    expect(topLeftBand).toBeLessThan(64);
    // Bottom-right INSIDE has no band → still close to the source fill.
    expect(bottomRightBand).toBeGreaterThan(192);
    // Centre of the shape is untouched.
    expect(interior).toBeGreaterThan(240);
    // Outside the shape is transparent (resvg fills with 0 alpha → 0
    // RGB). Luminance is 0, but the alpha being 0 is what matters —
    // assert the alpha channel directly to keep the "no outer leak"
    // intent explicit.
    const outsideAlphaIndex = (1 * width + 1) * 4 + 3;
    expect(pixels[outsideAlphaIndex]).toBeLessThan(16);
    // (luminance is unused for the outside cell but referenced so
    // future tweaks see the intent of probing the corner.)
    expect(outsideTopLeft).toBeLessThan(64);
  });

  // Negative offset must invert the band direction. This catches a
  // regression that hard-codes the inner band's corner regardless
  // of the offset sign.
  it("offset (-2, -2) paints the band on the inner BOTTOM-RIGHT", () => {
    const svg = buildInnerShadowSvg({
      size: 20,
      dx: -2,
      dy: -2,
      shadowColor: "black",
      fill: "white",
    });
    const { pixels, width } = rasterise(svg);
    const topLeftBand = pixelLuminance(pixels, width, 5, 5);
    const bottomRightBand = pixelLuminance(pixels, width, 22, 22);
    expect(bottomRightBand).toBeLessThan(64);
    expect(topLeftBand).toBeGreaterThan(192);
  });
});
