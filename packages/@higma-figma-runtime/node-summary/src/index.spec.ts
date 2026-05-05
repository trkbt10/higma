/**
 * @file Node summary contract tests.
 */

import { summarizeFigmaNodes } from ".";

describe("summarizeFigmaNodes", () => {
  it("counts node types and top-level fields", () => {
    const summary = summarizeFigmaNodes([
      { type: "FRAME", id: "1" },
      { type: "TEXT", id: "2", characters: "hello" },
      { type: { name: "FRAME" }, id: "3" },
      null,
    ]);

    expect(summary.totalNodes).toBe(4);
    expect(summary.nodeTypes.get("FRAME")).toBe(2);
    expect(summary.nodeTypes.get("TEXT")).toBe(1);
    expect(summary.topLevelFields.get("id")).toBe(3);
    expect(summary.topLevelFields.get("characters")).toBe(1);
  });
});
