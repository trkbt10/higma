/**
 * @file Case `inferred-row-padding-symmetric` — row inferer must
 * compute paddingLeft = paddingRight = HORIZ_PADDING and paddingTop =
 * TOP_PADDING from the children's rects.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import {
  BOTTOM_PADDING,
  HORIZ_PADDING,
  TOP_PADDING,
  withRowSymmetricPadding,
} from "./fixture";

describe("case inferred-row-padding-symmetric", () => {
  const ir = normalizeOne(withRowSymmetricPadding(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers a row from the uniformly-spaced children", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("derives paddingLeft from the first child's x-offset", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingLeft).toBe(HORIZ_PADDING);
  });

  it("derives paddingRight from parent.width - lastRight", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingRight).toBe(HORIZ_PADDING);
  });

  it("derives paddingTop from the row's top edge", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingTop).toBe(TOP_PADDING);
  });

  it("derives paddingBottom from parent.height - row's bottom", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingBottom).toBe(BOTTOM_PADDING);
  });
});
