/**
 * @file Unit tests for auto-layout inference.
 *
 * The inferrer must:
 *
 *   - Recognise a horizontal row of equal-height children sitting at
 *     the same y with uniform gaps (the Win98 "10" digit pair case).
 *   - Recognise a vertical column likewise.
 *   - Reject mixed cross-axis positions, overlapping children, and
 *     non-uniform gaps (fail-fast — no silent guessing).
 *   - Recursively walk nested FRAMEs.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { inferLayoutForFrame, inferLayouts } from "./layout-inference";
import { fakeFigNode } from "./test-helpers";

function rect(
  localID: number,
  tx: number,
  ty: number,
  width: number,
  height: number,
): FigNode {
  return fakeFigNode({
    type: { value: 6, name: "VECTOR" },
    guid: { sessionID: 1, localID },
    name: `c${localID}`,
    size: { x: width, y: height },
    transform: { m00: 1, m01: 0, m02: tx, m10: 0, m11: 1, m12: ty },
  });
}

function frame(
  localID: number,
  width: number,
  height: number,
  children: readonly FigNode[],
): FigNode {
  return fakeFigNode({
    type: { value: 4, name: "FRAME" },
    guid: { sessionID: 1, localID },
    name: `f${localID}`,
    size: { x: width, y: height },
    children,
  });
}

describe("inferLayoutForFrame — horizontal row", () => {
  it("recognises two equal-height children at the same y with a uniform gap (Win98 '10' case)", () => {
    // Parent FRAME 35x50.
    //   left  digit at tx=3,  ty=4, 11x42  → ends at x=14, y=46
    //   right digit at tx=17, ty=4, 11x42  → ends at x=28, y=46
    //   gap = 17 - 14 = 3
    //   padLeft = 3, padRight = 35 - 28 = 7
    //   padTop  = 4, padBottom = 50 - 46 = 4
    const left = rect(10, 3, 4, 11, 42);
    const right = rect(11, 17, 4, 11, 42);
    const f = frame(1, 35, 50, [left, right]);

    const hint = inferLayoutForFrame(f);
    expect(hint).toBeDefined();
    if (!hint) {
      throw new Error("hint expected");
    }
    expect(hint.layoutMode).toBe("HORIZONTAL");
    expect(hint.itemSpacing).toBe(3);
    expect(hint.paddingLeft).toBe(3);
    expect(hint.paddingRight).toBe(7);
    expect(hint.paddingTop).toBe(4);
    expect(hint.paddingBottom).toBe(4);
    expect(hint.childCount).toBe(2);
  });

  it("accepts MIN-aligned children with different heights as a row (auto-layout HUG handles size)", () => {
    // Same top y, different heights → MIN alignment. Auto-layout's
    // counter-axis HUG/FILL is the mechanism for this; the inferrer's
    // job is to recognise the alignment, not to require equal heights.
    const left = rect(10, 4, 4, 11, 42);
    const right = rect(11, 18, 4, 11, 30);
    const f = frame(1, 35, 50, [left, right]);
    const hint = inferLayoutForFrame(f);
    expect(hint).toBeDefined();
    expect(hint?.layoutMode).toBe("HORIZONTAL");
    expect(hint?.counterAxisAlign).toBe("MIN");
  });

  it("rejects when neither MIN, CENTER, nor MAX alignment holds across all children", () => {
    // Different y AND different heights → no shared top, center, or
    // bottom edge. This is the genuine "staircase" case we still must
    // reject.
    const a = rect(10, 4, 4, 10, 40);  // top=4, center=24, bottom=44
    const b = rect(11, 18, 9, 10, 25); // top=9, center=21.5, bottom=34
    const c = rect(12, 32, 13, 10, 40); // top=13, center=33, bottom=53
    const f = frame(1, 50, 60, [a, b, c]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });

  it("rejects when children sit at different y (the row is staircased)", () => {
    const left = rect(10, 4, 4, 11, 42);
    const right = rect(11, 18, 10, 11, 42); // ty differs
    const f = frame(1, 35, 50, [left, right]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });

  it("rejects when inter-child gaps are not uniform", () => {
    const a = rect(10, 4, 4, 10, 42);
    const b = rect(11, 17, 4, 10, 42); // gap=3
    const c = rect(12, 40, 4, 10, 42); // gap=13
    const f = frame(1, 60, 50, [a, b, c]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });

  it("rejects when children overlap on the primary axis", () => {
    const a = rect(10, 4, 4, 20, 42);
    const b = rect(11, 10, 4, 20, 42); // tx=10 < a.tx+a.width=24
    const f = frame(1, 50, 50, [a, b]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });
});

describe("inferLayoutForFrame — vertical column", () => {
  it("recognises a column of equal-width children at the same x with uniform gap", () => {
    const top = rect(10, 5, 6, 20, 8);
    const bot = rect(11, 5, 18, 20, 8); // ty = 6 + 8 + 4 = 18
    const f = frame(1, 30, 40, [top, bot]);
    const hint = inferLayoutForFrame(f);
    expect(hint).toBeDefined();
    if (!hint) {
      throw new Error("hint expected");
    }
    expect(hint.layoutMode).toBe("VERTICAL");
    expect(hint.itemSpacing).toBe(4);
    expect(hint.paddingTop).toBe(6);
    expect(hint.paddingBottom).toBe(14); // 40 - 18 - 8
    expect(hint.paddingLeft).toBe(5);
    expect(hint.paddingRight).toBe(5);
  });
});

describe("inferLayoutForFrame — refuses ambiguous & degenerate cases", () => {
  it("returns undefined for a frame with fewer than 2 children", () => {
    const f = frame(1, 30, 30, [rect(10, 0, 0, 30, 30)]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });

  it("returns undefined when a child is invisible (cannot tell whether to honour it)", () => {
    const hidden = fakeFigNode({
      type: { value: 6, name: "VECTOR" },
      guid: { sessionID: 1, localID: 12 },
      name: "hidden",
      size: { x: 10, y: 10 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      visible: false,
    });
    const a = rect(10, 0, 0, 10, 10);
    const b = rect(11, 20, 0, 10, 10);
    const f = frame(1, 40, 10, [a, b, hidden]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });

  it("returns undefined when both axes pass (single-point children, degenerate)", () => {
    // Two 0-size children at the same position: both axis checks
    // pass trivially. We refuse rather than pick.
    const a = rect(10, 5, 5, 0, 0);
    const b = rect(11, 5, 5, 0, 0);
    const f = frame(1, 10, 10, [a, b]);
    expect(inferLayoutForFrame(f)).toBeUndefined();
  });
});

describe("inferLayoutForFrame — cross-axis alignment", () => {
  it("detects CENTER alignment when children share the vertical centerline", () => {
    // Children with different heights but same center y = 25.
    const a = rect(10, 4, 5, 10, 40);   // top=5, center=25, bottom=45
    const b = rect(11, 18, 15, 10, 20); // top=15, center=25, bottom=35
    const f = frame(1, 40, 50, [a, b]);
    const hint = inferLayoutForFrame(f);
    expect(hint?.counterAxisAlign).toBe("CENTER");
    expect(hint?.layoutMode).toBe("HORIZONTAL");
  });

  it("detects MAX alignment when children share the bottom edge", () => {
    // Children with different heights but same bottom edge (ty+height = 45).
    const a = rect(10, 4, 5, 10, 40);   // top=5, bottom=45
    const b = rect(11, 18, 25, 10, 20); // top=25, bottom=45
    const f = frame(1, 40, 50, [a, b]);
    const hint = inferLayoutForFrame(f);
    expect(hint?.counterAxisAlign).toBe("MAX");
    expect(hint?.layoutMode).toBe("HORIZONTAL");
  });
});

describe("inferLayouts — recursive walk", () => {
  it("finds hints in nested frames", () => {
    const innerRow = frame(2, 30, 10, [rect(20, 5, 0, 10, 10), rect(21, 17, 0, 10, 10)]);
    const outerCol = frame(1, 30, 40, [innerRow, rect(22, 0, 14, 30, 26)]);
    const hints = inferLayouts([outerCol]);
    expect(hints.length).toBeGreaterThan(0);
    const inner = hints.find((h) => h.nodeGuid === "1:2");
    expect(inner?.layoutMode).toBe("HORIZONTAL");
  });
});
