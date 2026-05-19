/**
 * @file Case `gradient-linear` — CSS linear-gradient becomes a single
 * `linear-gradient` PaintIR with the angle in CSS-degree convention
 * (0° = up, 90° = right) and stops in source order.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { withLinearGradient } from "./fixture";

describe("case gradient-linear", () => {
  const frame = asFrame(singleChild(normalizeOne(withLinearGradient(baseDiv()))));

  it("emits a single fill", () => {
    expect(frame.style.fills).toHaveLength(1);
  });

  it("translates `to right` to 90°", () => {
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "linear-gradient") {
      throw new Error("expected linear-gradient paint");
    }
    expect(fill.angle).toBe(90);
  });

  it("preserves stop count and stop colours in source order", () => {
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "linear-gradient") {
      throw new Error("expected linear-gradient paint");
    }
    expect(fill.stops).toHaveLength(2);
    expect(fill.stops[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(fill.stops[1]!.color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(fill.stops[0]!.position).toBe(0);
    expect(fill.stops[1]!.position).toBe(1);
  });
});
