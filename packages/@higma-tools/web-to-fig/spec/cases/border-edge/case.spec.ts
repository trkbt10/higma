/**
 * @file Case `border-edge` — single-edge borders pick the colour from
 * the dominant edge, not blindly from `border-top-color`.
 *
 * Regression: prior to the fix, an authored
 * `border-bottom: 2px solid pink` painted black because
 * `collectStrokes` always read `border-top-color` (which defaulted to
 * `rgb(0, 0, 0)`). The case asserts the colour comes from the bottom.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_WIDTH_PX, withSingleEdgeBorder } from "./fixture";

describe("case border-edge", () => {
  const frame = asFrame(singleChild(normalizeOne(withSingleEdgeBorder(baseDiv()))));

  it("emits exactly one stroke (Figma IR is single-stroke)", () => {
    expect(frame.style.strokes).toHaveLength(1);
  });

  it("stroke weight equals the bordered edge's width", () => {
    expect(frame.style.strokes[0]!.weight).toBe(DEFAULT_EDGE_WIDTH_PX);
  });

  it("stroke colour comes from the dominant (non-zero) edge — not the top default", () => {
    const paint = frame.style.strokes[0]!.paint;
    if (paint.kind !== "solid") {
      throw new Error("expected SOLID stroke paint");
    }
    // DEFAULT_EDGE_COLOR is rgb(255, 0, 128).
    expect(paint.color.r).toBeCloseTo(1, 3);
    expect(paint.color.g).toBeCloseTo(0, 3);
    expect(paint.color.b).toBeCloseTo(128 / 255, 3);
    void DEFAULT_EDGE_COLOR;
  });

  it("works on every side — top / right / bottom / left", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const f = asFrame(
        singleChild(normalizeOne(withSingleEdgeBorder(baseDiv(), side, 1, "rgb(0, 200, 0)"))),
      );
      expect(f.style.strokes).toHaveLength(1);
      const paint = f.style.strokes[0]!.paint;
      if (paint.kind !== "solid") {
        throw new Error("expected SOLID stroke paint");
      }
      expect(paint.color.g).toBeCloseTo(200 / 255, 3);
    }
  });
});
