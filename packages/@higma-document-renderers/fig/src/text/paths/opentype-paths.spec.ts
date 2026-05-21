/**
 * @file Font-outline text path tests.
 */

import type { AbstractFont, AbstractGlyph, FontPath } from "@higma-document-models/fig/font";
import type { PathCommand } from "@higma-primitives/path";
import { createUnderlineRect, extractTextPathData } from "./opentype-paths";
import { figmaTextOutlineBaselineY } from "./text-outline-baseline";

function path(commands: readonly PathCommand[]): FontPath {
  return {
    commands,
    toPathData: () => "",
  };
}

function recordingFont(recordedBaselines: number[]): AbstractFont {
  const glyph: AbstractGlyph = {
    index: 1,
    advanceWidth: 1000,
    getPath: (x, y) => {
      recordedBaselines.push(y);
      return path([{ type: "M", x, y }]);
    },
  };

  return {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    charToGlyph: () => glyph,
    getPath: (_text, x, y) => path([{ type: "M", x, y }]),
  };
}

describe("figmaTextOutlineBaselineY", () => {
  it("projects Kiwi fractional baselines to Figma SVG outline baselines", () => {
    expect(figmaTextOutlineBaselineY(9.5546875)).toBe(10);
    expect(figmaTextOutlineBaselineY(9.4453125)).toBe(9);
  });

  it("fails on invalid baseline input", () => {
    expect(() => figmaTextOutlineBaselineY(Number.NaN)).toThrow(/baselineY must be finite/);
  });
});

describe("extractTextPathData", () => {
  it("uses the same Figma outline baseline projection as derived glyph paths", () => {
    const recordedBaselines: number[] = [];
    const result = extractTextPathData({
      lines: ["A"],
      font: recordingFont(recordedBaselines),
      fontSize: 10,
      x: 3,
      baseY: 9.5546875,
      lineHeight: 12,
      align: "LEFT",
    });

    expect(recordedBaselines).toEqual([10]);
    const command = result.glyphContours[0]?.commands[0];
    if (command?.type !== "M") {
      throw new Error("expected first glyph command");
    }
    expect(command).toEqual({ type: "M", x: 3, y: 10 });
  });
});

describe("createUnderlineRect", () => {
  it("uses the projected outline baseline for decoration geometry", () => {
    const rect = createUnderlineRect({
      text: "A",
      font: recordingFont([]),
      fontSize: 10,
      x: 3,
      y: 9.5546875,
      align: "LEFT",
    });

    expect(rect).toEqual({
      x: 3,
      y: 11.9,
      width: 10,
      height: 0.68,
    });
  });
});
