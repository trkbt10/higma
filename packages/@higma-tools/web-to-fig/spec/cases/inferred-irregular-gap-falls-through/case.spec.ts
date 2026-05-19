/**
 * @file Case `inferred-irregular-gap-falls-through` — irregular child
 * spacing must fall through to `direction: "none"`. The contract is
 * conservative: the inferer never invents a uniform layout that the
 * captured geometry doesn't support.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { CHILD_COUNT, withIrregularGapRow } from "./fixture";

describe("case inferred-irregular-gap-falls-through", () => {
  const ir = normalizeOne(withIrregularGapRow(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all children even when no layout can be inferred", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("returns `direction: none` rather than inventing a uniform row", () => {
    expect(frame.autoLayout.direction).toBe("none");
  });
});
