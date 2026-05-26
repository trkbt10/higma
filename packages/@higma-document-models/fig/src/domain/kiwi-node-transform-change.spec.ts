/** @file Tests for Kiwi transform-only node comparison. */
import { NODE_TYPE_VALUES } from "../constants";
import type { FigNode } from "../types";
import { sameKiwiNodeExceptTransform } from "./kiwi-node-transform-change";

function node(name: string): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    name,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
  };
}

describe("sameKiwiNodeExceptTransform", () => {
  it("accepts a transform-only change", () => {
    const before = node("Layer");
    const after: FigNode = {
      ...before,
      transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 4 },
    };

    expect(sameKiwiNodeExceptTransform(before, after)).toBe(true);
  });

  it("rejects non-transform content changes", () => {
    const before = node("Before");
    const after: FigNode = {
      ...before,
      name: "After",
      transform: { m00: 1, m01: 0, m02: 12, m10: 0, m11: 1, m12: 4 },
    };

    expect(sameKiwiNodeExceptTransform(before, after)).toBe(false);
  });
});
