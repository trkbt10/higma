/**
 * @file Case `inferred-mixed-counter-falls-through` — uniform primary
 * axis but staggered counter axis must reject every alignment label
 * and fall through to `direction: "none"`.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { CHILD_COUNT, withMixedCounterAxis } from "./fixture";

describe("case inferred-mixed-counter-falls-through", () => {
  const ir = normalizeOne(withMixedCounterAxis(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all children even when no alignment fits", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("falls through to `direction: none` when counter axis is mixed", () => {
    expect(frame.autoLayout.direction).toBe("none");
  });
});
