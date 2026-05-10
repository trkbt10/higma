/**
 * @file Case `inferred-column-from-block` — vertically stacked block
 * children must inflate to AutoLayoutIR `direction: "column"` with the
 * authored gap and top padding. Asserts the column branch of
 * `inferAutoLayout` is reachable from web-to-fig.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import {
  CHILD_COUNT,
  CHILD_GAP,
  PARENT_PADDING_TOP,
  withInferredColumn,
} from "./fixture";

describe("case inferred-column-from-block", () => {
  const ir = normalizeOne(withInferredColumn(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all children", () => {
    expect(frame.children).toHaveLength(CHILD_COUNT);
  });

  it("infers `direction: column` from vertical stacking", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected inferer to detect column from child rects");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("recovers the authored vertical gap", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(CHILD_GAP);
  });

  it("recovers the top padding from the first child's offset", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.paddingTop).toBe(PARENT_PADDING_TOP);
  });
});
