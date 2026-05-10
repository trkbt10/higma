/**
 * @file Case `inferred-row-ignores-absolute-sibling` — the inferer
 * must consider only the flow children, not the absolutely-positioned
 * badge that overlaps the row band. Asserts:
 *
 *   - All four children survive in the IR (nothing is dropped).
 *   - The inferred row direction matches the flow children only.
 *   - The badge child carries `sizing.mode === "absolute"`.
 *   - The flow children carry `sizing.mode === "flow"`.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import {
  FLOW_CHILD_COUNT,
  FLOW_GAP,
  withRowAndAbsoluteSibling,
} from "./fixture";

describe("case inferred-row-ignores-absolute-sibling", () => {
  const ir = normalizeOne(withRowAndAbsoluteSibling(baseDiv()));
  const frame = asFrame(singleChild(ir));

  it("preserves all four children in the IR (3 flow + 1 badge)", () => {
    expect(frame.children).toHaveLength(FLOW_CHILD_COUNT + 1);
  });

  it("infers a row from the flow children only", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout from the flow siblings");
    }
    expect(frame.autoLayout.direction).toBe("row");
  });

  it("recovers the flow gap (the badge does not pollute it)", () => {
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected row autoLayout");
    }
    expect(frame.autoLayout.gap).toBe(FLOW_GAP);
  });

  it("marks the badge child with sizing.mode = 'absolute'", () => {
    const badge = frame.children[frame.children.length - 1]!;
    expect(badge.sizing.mode).toBe("absolute");
  });

  it("leaves the flow children with sizing.mode = 'flow'", () => {
    for (let i = 0; i < FLOW_CHILD_COUNT; i += 1) {
      const child = frame.children[i]!;
      expect(child.sizing.mode).toBe("flow");
    }
  });
});
