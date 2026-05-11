/**
 * @file Case `svg-vector-group-transform` — verify that an SVG path
 * captured with an accumulated `<g transform>` chain has its
 * transform baked into `d` by the normaliser, so Figma's VECTOR
 * receives geometry already in viewBox coordinates.
 */
import { asVector, normalizeOne, singleChild } from "../_helpers";
import { PATH_AT_ORIGIN_D, svgWithGroupTransform } from "./fixture";

describe("case svg-vector-group-transform", () => {
  const vector = asVector(singleChild(normalizeOne(svgWithGroupTransform())));

  it("preserves the inline SVG viewBox", () => {
    expect(vector.viewBox).toEqual({ minX: 0, minY: 0, width: 50, height: 50 });
  });

  it("emits exactly one VectorPathIR per captured `<path>`", () => {
    expect(vector.paths).toHaveLength(1);
  });

  it("bakes `<g transform>` translate(20, 30) into `d` (the path no longer starts at origin)", () => {
    const baked = vector.paths[0]!.d;
    // The original path started with "M 0 0"; after baking it must
    // start at the translated origin (20, 30).
    expect(baked).toContain("M 20 30");
    // Sanity check: the original origin form must be gone.
    expect(baked).not.toBe(PATH_AT_ORIGIN_D);
  });

  it("preserves the SOLID fill from the captured path", () => {
    const fill = vector.paths[0]!.fill;
    if (!fill || fill.kind !== "solid") {
      throw new Error("expected SOLID fill");
    }
    expect(fill.color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
  });
});
