/**
 * @file Case `fixed-masthead-flex-row` — verifies the `position: fixed`
 * lift path AND the lifted subtree's flex normalisation. Both halves
 * are real-world signals: YouTube's masthead exercises this every
 * page load, and a regression in either half makes the entire header
 * disappear from the .fig output.
 */
import { normalizeOne } from "../case-ir-assertions";
import { fixedMastheadFlexRow, MASTHEAD_RECT } from "./fixture";

describe("case fixed-masthead-flex-row", () => {
  const ir = normalizeOne(fixedMastheadFlexRow());

  it("lifts the fixed subtree out of the static root", () => {
    if (ir.root.kind !== "frame") {
      throw new Error("expected root frame");
    }
    expect(ir.root.children).toHaveLength(0);
  });

  it("registers exactly one viewport-layer entry for the masthead", () => {
    expect(ir.viewportLayer).toHaveLength(1);
  });

  it("preserves the masthead's captured viewport-absolute rect", () => {
    const lifted = ir.viewportLayer[0]!;
    expect(lifted.box.width).toBe(MASTHEAD_RECT.width);
    expect(lifted.box.height).toBe(MASTHEAD_RECT.height);
  });

  it("normalises the lifted masthead with row autoLayout from CSS flex", () => {
    const lifted = ir.viewportLayer[0]!;
    if (lifted.kind !== "frame") {
      throw new Error("expected lifted masthead to be a frame");
    }
    if (lifted.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout from explicit flex");
    }
    expect(lifted.autoLayout.direction).toBe("row");
  });

  it("preserves all three flex children on the lifted masthead", () => {
    const lifted = ir.viewportLayer[0]!;
    if (lifted.kind !== "frame") {
      throw new Error("expected lifted masthead to be a frame");
    }
    expect(lifted.children).toHaveLength(3);
  });

  it("pins the lifted entry with sizing.mode = 'absolute'", () => {
    const lifted = ir.viewportLayer[0]!;
    expect(lifted.sizing.mode).toBe("absolute");
  });
});
