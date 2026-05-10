/**
 * @file Case `flex-row-gap` — `display: flex; flex-direction: row; gap: Npx`
 * produces a `direction: "row"` AutoLayoutIR with the authored gap
 * verbatim, plus the right number of children.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import {
  DEFAULT_CHILD_COUNT,
  DEFAULT_GAP_PX,
  withFlexRowGap,
} from "./fixture";

describe("case flex-row-gap", () => {
  const ir = normalizeOne(withFlexRowGap(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("has the right number of children", () => {
    expect(frame.children).toHaveLength(DEFAULT_CHILD_COUNT);
  });

  it("infers `direction: row` from CSS flex", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("encodes the authored gap in px", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(DEFAULT_GAP_PX);
  });

  it("emits zero padding when none was authored", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.paddingTop).toBe(0);
    expect(frame.autoLayout.paddingRight).toBe(0);
    expect(frame.autoLayout.paddingBottom).toBe(0);
    expect(frame.autoLayout.paddingLeft).toBe(0);
  });

  it("defaults primaryAlign to `start` and counterAlign to `start` when unset", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.primaryAlign).toBe("start");
    expect(frame.autoLayout.counterAlign).toBe("start");
  });
});
