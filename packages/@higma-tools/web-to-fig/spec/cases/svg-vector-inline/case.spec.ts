/**
 * @file Case `svg-vector-inline` — inline `<svg>` becomes a
 * VectorNodeIR with viewBox preserved and each `<path>` translated
 * to a `VectorPathIR` with the resolved fill.
 */
import { asVector, normalizeOne, singleChild } from "../case-ir-assertions";
import { DEFAULT_SVG_PATH_D, inlineSvgVector } from "./fixture";

describe("case svg-vector-inline", () => {
  const vector = asVector(singleChild(normalizeOne(inlineSvgVector())));

  it("preserves the viewBox verbatim", () => {
    expect(vector.viewBox).toEqual({ minX: 0, minY: 0, width: 24, height: 24 });
  });

  it("emits one VectorPathIR per `<path>`", () => {
    expect(vector.paths).toHaveLength(1);
    expect(vector.paths[0]!.d).toBe(DEFAULT_SVG_PATH_D);
  });

  it("translates the path's `fill` attribute into a SOLID PaintIR", () => {
    const fill = vector.paths[0]!.fill;
    if (!fill || fill.kind !== "solid") {
      throw new Error("expected SOLID path fill");
    }
    expect(fill.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});
