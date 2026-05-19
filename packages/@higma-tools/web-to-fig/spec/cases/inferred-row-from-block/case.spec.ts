/**
 * @file Case `inferred-row-from-block` — `display: block` parent with
 * row-shaped child rects must inflate to AutoLayoutIR
 * `direction: "row"` via `inferAutoLayout`. This is the ONLY signal
 * the bridge has to recover a row container from a block parent, so
 * regressing it would freeze every non-flex-authored toolbar as
 * absolute children.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import {
  CHILD_COUNT,
  CHILD_GAP,
  PARENT_PADDING_LEFT,
  withInferredRow,
} from "./fixture";

describe("case inferred-row-from-block", () => {
  const ir = normalizeOne(withInferredRow(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all children", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("infers `direction: row` purely from child geometry", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected inferer to detect row from child rects");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("recovers the authored gap as the inferred gap", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(CHILD_GAP);
  });

  it("recovers the leading padding as paddingLeft", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingLeft).toBe(PARENT_PADDING_LEFT);
  });
});
