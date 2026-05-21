/**
 * @file Rounded rectangle SVG path tests.
 */

import { buildRoundedRectPathD, buildSmoothedRoundedRectPathD } from "./svg-rounded-rect";

describe("svg rounded rect path", () => {
  it("clamps oversized radii to the rectangle geometry", () => {
    const d = buildRoundedRectPathD(44, 44, [1000, 1000, 1000, 1000]);

    expect(d).not.toContain("1000");
    expect(d).not.toContain("-956");
    expect(d).toContain("M 22 0");
    expect(d).toContain("L 22 0");
  });

  it("reduces smoothing when the smoothed corner extent cannot fit the edges", () => {
    const rounded = buildRoundedRectPathD(44, 44, [1000, 1000, 1000, 1000]);
    const smoothed = buildSmoothedRoundedRectPathD(44, 44, [1000, 1000, 1000, 1000], 0.6);

    expect(smoothed).toBe(rounded);
  });

  it("keeps smoothing when the smoothed corner extent fits the edges", () => {
    const rounded = buildRoundedRectPathD(100, 100, [20, 20, 20, 20]);
    const smoothed = buildSmoothedRoundedRectPathD(100, 100, [20, 20, 20, 20], 0.6);

    expect(smoothed).not.toBe(rounded);
    expect(smoothed).toContain("M 0 32");
  });
});
