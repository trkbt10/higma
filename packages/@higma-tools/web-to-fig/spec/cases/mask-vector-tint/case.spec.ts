/**
 * @file Case `mask-vector-tint` — `mask-image` SVG re-coloured with
 * the host's CSS `color` (no `background-color`).
 */
import { asVector, normalizeOne, singleChild } from "../case-ir-assertions";
import { DEFAULT_MASK_PATH_D, maskedSpan } from "./fixture";

describe("case mask-vector-tint", () => {
  const vector = asVector(singleChild(normalizeOne(maskedSpan())));

  it("emits one path per `<path>` in the mask SVG", () => {
    expect(vector.paths).toHaveLength(1);
    expect(vector.paths[0]!.d).toBe(DEFAULT_MASK_PATH_D);
  });

  it("re-tints the path with the host element's CSS `color`", () => {
    const fill = vector.paths[0]!.fill;
    if (!fill || fill.kind !== "solid") {
      throw new Error("expected SOLID path fill");
    }
    // DEFAULT_TINT = rgb(50, 100, 200).
    expect(fill.color.r * 255).toBeCloseTo(50, 0);
    expect(fill.color.g * 255).toBeCloseTo(100, 0);
    expect(fill.color.b * 255).toBeCloseTo(200, 0);
  });
});
