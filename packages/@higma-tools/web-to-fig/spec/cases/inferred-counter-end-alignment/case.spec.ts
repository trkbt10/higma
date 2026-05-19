/**
 * @file Case `inferred-counter-end-alignment` — children that share a
 * common bottom edge with varying heights must produce
 * `counterAlign: "end"`. Asserts the third branch (after
 * stretch / start) of `inferCounterAlignment` is reachable.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { withCounterEndAlignment } from "./fixture";

describe("case inferred-counter-end-alignment", () => {
  const ir = normalizeOne(withCounterEndAlignment(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers `direction: row` from the horizontally-spread children", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("infers `counterAlign: end` from the shared bottom edge", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.counterAlign).toBe("end");
  });
});
