/**
 * @file Case `flex-nested` — both the outer column and inner row
 * carry their own AutoLayoutIR. Asserts the recursion through
 * `normalizeFrame` doesn't lose autolayout on inner subtrees.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { INNER_GAP, OUTER_GAP, nestedFlex } from "./fixture";

describe("case flex-nested", () => {
  const outer = asFrame(singleChild(normalizeOne(nestedFlex())));

  it("outer is a column with the authored gap", () => {
    if (outer.autoLayout.direction === "none") {
      throw new Error("expected outer column");
    }
    expect(outer.autoLayout.direction).toBe("column");
    expect(outer.autoLayout.gap).toBe(OUTER_GAP);
  });

  it("outer has 2 children: the title TEXT and the inner row FRAME", () => {
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0]!.kind).toBe("text");
    expect(outer.children[1]!.kind).toBe("frame");
  });

  it("inner row carries its own row autoLayout with the inner gap", () => {
    const innerRow = outer.children[1]!;
    if (innerRow.kind !== "frame") {
      throw new Error("");
    }
    if (innerRow.autoLayout.direction === "none") {
      throw new Error("expected inner row");
    }
    expect(innerRow.autoLayout.direction).toBe("row");
    expect(innerRow.autoLayout.gap).toBe(INNER_GAP);
  });
});
