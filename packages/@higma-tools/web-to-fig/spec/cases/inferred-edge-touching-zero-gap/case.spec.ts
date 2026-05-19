/**
 * @file Case `inferred-edge-touching-zero-gap` — touching children
 * must produce a row with `gap: 0`, not be rejected as overlapping.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { CHILD_COUNT, withEdgeTouchingChildren } from "./fixture";

describe("case inferred-edge-touching-zero-gap", () => {
  const ir = normalizeOne(withEdgeTouchingChildren(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all touching children", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("infers a row even though gaps are zero", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout (gap=0 is still a row)");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("emits `gap: 0` exactly", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(0);
  });
});
