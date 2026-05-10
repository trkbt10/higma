/**
 * @file Case `inferred-single-child-inset` — single horizontally-centred
 * child must produce `counterAlign: "center"` with zero left/right
 * padding (the `inferInset` branch). Asserts the asymmetry between
 * single-child and multi-child counter-axis treatment, which is
 * intentional per `infer.ts`'s `inferInset` comment.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { CHILD_TOP_INSET, withSingleCentredChild } from "./fixture";

describe("case inferred-single-child-inset", () => {
  const ir = normalizeOne(withSingleCentredChild(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("infers `direction: column` for the single-child host", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout from inferInset");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });

  it("promotes horizontal symmetry to `counterAlign: center`", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.counterAlign).toBe("center");
  });

  it("zeroes horizontal padding so the INSTANCE re-centres on resize", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.paddingLeft).toBe(0);
    expect(frame.autoLayout.paddingRight).toBe(0);
  });

  it("preserves the literal top inset as paddingTop", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.paddingTop).toBe(CHILD_TOP_INSET);
  });
});
