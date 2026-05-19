/**
 * @file Case `flex-column` — `flex-direction: column` produces a
 * `direction: "column"` AutoLayoutIR.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_GAP_PX, withFlexColumn } from "./fixture";

describe("case flex-column", () => {
  const ir = normalizeOne(withFlexColumn(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("encodes `direction: column`", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("preserves the authored gap", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(DEFAULT_GAP_PX);
  });
});
