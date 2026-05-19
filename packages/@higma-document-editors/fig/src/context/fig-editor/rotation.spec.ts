/** @file Tests for editor rotation math. */

import type { FigMatrix } from "@higma-document-models/fig/types";
import { computePreRotationTopLeft, extractRotationDeg } from "./rotation";

function translate(x: number, y: number): FigMatrix {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

describe("extractRotationDeg", () => {
  it("reads rotation from the Kiwi affine matrix", () => {
    const radians = Math.PI / 4;
    expect(extractRotationDeg({
      m00: Math.cos(radians),
      m01: -Math.sin(radians),
      m02: 0,
      m10: Math.sin(radians),
      m11: Math.cos(radians),
      m12: 0,
    })).toBeCloseTo(45);
  });
});

describe("computePreRotationTopLeft", () => {
  it("returns the transform translation for unrotated nodes", () => {
    expect(computePreRotationTopLeft(translate(100, 200), 50, 30)).toEqual({ x: 100, y: 200 });
  });

  it("resolves the visual top-left for a center-rotated node", () => {
    const transform: FigMatrix = { m00: 0, m01: -1, m02: 100, m10: 1, m11: 0, m12: 200 };

    expect(computePreRotationTopLeft(transform, 50, 30)).toEqual({ x: 60, y: 210 });
  });
});
