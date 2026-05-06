/** @file Tests for WebGL text visibility checks. */

import type { RenderTextLines } from "../scene-graph/render-tree";
import { hasVisibleLineText } from "./text-visibility";

function makeLines(lines: readonly string[]): RenderTextLines {
  return {
    mode: "lines",
    layout: {
      lines: lines.map((text, index) => ({ text, x: 0, y: index * 16 })),
      fontFamily: "Inter",
      fontSize: 16,
      lineHeight: 16,
      textAnchor: "start",
    },
  };
}

describe("hasVisibleLineText", () => {
  it("returns false for whitespace-only line text", () => {
    expect(hasVisibleLineText(makeLines([" "]))).toBe(false);
    expect(hasVisibleLineText(makeLines(["\t", "\n"]))).toBe(false);
  });

  it("returns true for line text with visible characters", () => {
    expect(hasVisibleLineText(makeLines([" ", "Hello"]))).toBe(true);
  });
});
