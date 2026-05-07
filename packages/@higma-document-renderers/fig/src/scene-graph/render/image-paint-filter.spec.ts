/** @file Image paint filter transfer tests. */

import {
  applyImagePaintFilterToRgb,
  createImagePaintFilterTables,
  hasImagePaintFilter,
  resolveImagePaintFilterUniforms,
} from "./image-paint-filter";

describe("image paint filters", () => {
  it("detects non-zero filter fields", () => {
    expect(hasImagePaintFilter(undefined)).toBe(false);
    expect(hasImagePaintFilter({ highlights: 0 })).toBe(false);
    expect(hasImagePaintFilter({ detail: 0, vignette: 0 })).toBe(false);
    expect(hasImagePaintFilter({ brightness: 0.1 })).toBe(true);
  });

  it("throws for unsupported visible filter fields", () => {
    expect(() => hasImagePaintFilter({ highlights: -0.98 })).toThrow("IMAGE paintFilter.highlights is not supported by the renderer");
    expect(() => hasImagePaintFilter({ shadows: 0.5 })).toThrow("IMAGE paintFilter.shadows is not supported by the renderer");
    expect(() => hasImagePaintFilter({ detail: 0.25 })).toThrow("IMAGE paintFilter.detail is not supported by the renderer");
    expect(() => resolveImagePaintFilterUniforms({ vignette: -0.5 })).toThrow("IMAGE paintFilter.vignette is not supported by the renderer");
  });

  it("throws for non-finite filter values", () => {
    expect(() => hasImagePaintFilter({ highlights: Number.NaN })).toThrow("IMAGE paintFilter.highlights requires a finite numeric value");
  });

  it("maps brightness into lighter channel table entries", () => {
    const tables = createImagePaintFilterTables({ brightness: 0.1 });
    const redValues = tables.red.split(" ").map(Number);

    expect(redValues[0]).toBe(0.1);
    expect(redValues[redValues.length - 2]).toBeGreaterThan((redValues.length - 2) / (redValues.length - 1));
    expect(redValues[redValues.length - 1]).toBe(1);
  });

  it("uses linear sRGB luminance when fully desaturating image colors", () => {
    const color = applyImagePaintFilterToRgb({ r: 0, g: 0, b: 1 }, { vibrance: -1 });

    expect(color.r).toBeCloseTo(0.2979, 3);
    expect(color.g).toBeCloseTo(0.2979, 3);
    expect(color.b).toBeCloseTo(0.2979, 3);
  });

  it("resolves missing filter uniforms to identity values", () => {
    expect(resolveImagePaintFilterUniforms(undefined)).toEqual({
      exposure: 0,
      contrast: 0,
      brightness: 0,
      temperature: 0,
      tint: 0,
      saturation: 0,
      vibrance: 0,
    });
  });
});
