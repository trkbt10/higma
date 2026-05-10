/**
 * @file Case `flex-justify-space-between` — `justify-content:
 * space-between` maps to `primaryAlign: "space-between"`.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { withFlexRowSpaceBetween } from "./fixture";

describe("case flex-justify-space-between", () => {
  const frame = asFrame(singleChild(normalizeOne(withFlexRowSpaceBetween(baseDiv()))));

  it("encodes `primaryAlign: space-between`", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.primaryAlign).toBe("space-between");
  });
});
