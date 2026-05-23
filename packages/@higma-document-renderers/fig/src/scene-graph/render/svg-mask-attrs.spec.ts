/** @file SVG mask element attribute resolution tests. */

import { resolveSvgMaskElementAttrs } from "./svg-mask-attrs";

describe("resolveSvgMaskElementAttrs", () => {
  it("preserves exact mask bounds so export projection owns coordinate quantization", () => {
    const attrs = resolveSvgMaskElementAttrs({
      id: "mask-1",
      maskType: "alpha",
      bounds: {
        x: 1.8189894035458565e-12,
        y: -9.094947017729282e-13,
        width: 114,
        height: 248,
      },
    });

    expect(attrs).toEqual({
      id: "mask-1",
      maskType: "alpha",
      maskUnits: "userSpaceOnUse",
      x: "1.8189894035458565e-12",
      y: "-9.094947017729282e-13",
      width: "114",
      height: "248",
    });
  });

  it("rejects non-positive mask regions at the shared SVG backend boundary", () => {
    expect(() => resolveSvgMaskElementAttrs({
      id: "mask-1",
      maskType: "alpha",
      bounds: { x: 0, y: 0, width: 0, height: 10 },
    })).toThrow("Mask mask-1 has a non-positive SVG mask region");
  });
});
