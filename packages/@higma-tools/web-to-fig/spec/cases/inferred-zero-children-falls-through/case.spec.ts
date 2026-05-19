/**
 * @file Case `inferred-zero-children-falls-through` — empty parent
 * must produce a FRAME with `direction: "none"` and zero children.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { withNoChildren } from "./fixture";

describe("case inferred-zero-children-falls-through", () => {
  const ir = normalizeOne(withNoChildren(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves the empty children list", () => {
    expect(frame.children).toHaveLength(0);
  });

  it("returns `direction: none` (no layout to infer from zero children)", () => {
    expect(frame.autoLayout.direction).toBe("none");
  });
});
