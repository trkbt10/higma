/**
 * @file Case `inferred-column-with-asymmetric-padding` — all four
 * padding sides must be derived independently. Asserts none collapses
 * into a single value.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import {
  BOTTOM_PADDING,
  LEFT_PADDING,
  RIGHT_PADDING,
  TOP_PADDING,
  withColumnAsymmetricPadding,
} from "./fixture";

describe("case inferred-column-with-asymmetric-padding", () => {
  const ir = normalizeOne(withColumnAsymmetricPadding(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers a column from the vertical stacking", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("derives each of the four padding sides independently", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.paddingTop).toBe(TOP_PADDING);
    expect(frame.autoLayout.paddingBottom).toBe(BOTTOM_PADDING);
    expect(frame.autoLayout.paddingLeft).toBe(LEFT_PADDING);
    expect(frame.autoLayout.paddingRight).toBe(RIGHT_PADDING);
  });
});
