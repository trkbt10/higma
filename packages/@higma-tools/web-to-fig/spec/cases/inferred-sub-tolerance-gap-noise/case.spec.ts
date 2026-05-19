/**
 * @file Case `inferred-sub-tolerance-gap-noise` — gaps that wobble
 * within `GAP_TOLERANCE` must collapse to a single uniform gap (the
 * average), not reject the row pattern. Asserts the tolerance budget
 * does its job for subpixel-rounded captures.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { NOMINAL_GAP, withSubToleranceGapNoise } from "./fixture";

describe("case inferred-sub-tolerance-gap-noise", () => {
  const ir = normalizeOne(withSubToleranceGapNoise(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("absorbs subpixel gap noise as a row autoLayout", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout despite gap noise");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("emits the average of the noisy gaps", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBeCloseTo(NOMINAL_GAP, 5);
  });
});
