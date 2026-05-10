/**
 * @file Case `inferred-from-grid-equal-cells` — `display: grid` with a
 * single equal-cell row must inflate to AutoLayoutIR
 * `direction: "row"` via `inferAutoLayout`. There is no grid-aware
 * branch in `resolveAutoLayout` today; this case asserts that the
 * fallback to the inferer Just Works for the 1xN case (the most
 * common one in real pages).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import {
  CELL_COUNT,
  CELL_GAP,
  withGridSingleRow,
} from "./fixture";

describe("case inferred-from-grid-equal-cells", () => {
  const ir = normalizeOne(withGridSingleRow(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all cells", () => {
    expect(frame.children).toHaveLength(CELL_COUNT);
  });

  it("infers `direction: row` for a 1xN grid", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected inferer to detect row from grid cells");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("recovers the authored gap as the inferred gap", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(CELL_GAP);
  });
});
