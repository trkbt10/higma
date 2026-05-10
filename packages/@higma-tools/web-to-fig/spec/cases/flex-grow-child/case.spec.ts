/**
 * @file Case `flex-grow-child` — a flex row with a middle `flex-grow: 1`
 * child must:
 *
 *   - Take `direction: "row"` from CSS verbatim (no inference).
 *   - Preserve the authored gap.
 *   - Record the grown child's wide post-layout rect on its frame
 *     bounds (the IR doesn't yet have a sizing.primary STRETCH hint,
 *     so the wide width is the only signal a downstream renderer can
 *     use to reproduce the layout at the captured viewport size).
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import {
  GAP,
  GROWN_INDEX,
  GROWN_WIDTH,
  SIDE_WIDTH,
  withFlexGrowChild,
} from "./fixture";

describe("case flex-grow-child", () => {
  const ir = normalizeOne(withFlexGrowChild(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("takes direction:row from explicit flex CSS", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout from explicit flex");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("preserves the authored gap", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(GAP);
  });

  it("records the grown child's wide post-layout width on the IR frame", () => {
    const grown = frame.children[GROWN_INDEX];
    if (!grown || grown.kind !== "frame") {
      throw new Error("expected grown child to be a frame");
    }
    expect(grown.box.width).toBe(GROWN_WIDTH);
  });

  it("keeps siblings at their authored widths (no implicit stretch)", () => {
    const left = frame.children[0];
    const right = frame.children[2];
    if (!left || left.kind !== "frame") {
      throw new Error("expected left sibling to be a frame");
    }
    if (!right || right.kind !== "frame") {
      throw new Error("expected right sibling to be a frame");
    }
    expect(left.box.width).toBe(SIDE_WIDTH);
    expect(right.box.width).toBe(SIDE_WIDTH);
  });
});
