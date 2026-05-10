/**
 * @file Case `inferred-overlapping-children-fall-through` — overlapping
 * primary-axis siblings must NOT inflate to a row autoLayout. The IR
 * keeps the children verbatim but pins `direction: "none"` so the
 * downstream emitter doesn't try to re-flow them.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { CHILD_COUNT, withOverlappingChildren } from "./fixture";

describe("case inferred-overlapping-children-fall-through", () => {
  const ir = normalizeOne(withOverlappingChildren(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all overlapping children", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("rejects the row pattern for overlapping primary axes", () => {
    expect(frame.autoLayout.direction).toBe("none");
  });
});
