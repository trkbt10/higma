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
  it("passes the float baseline straight through to opentype.js — Figma's SVG export keeps the fractional baseline for font-driven outlines", () => {
    const recordedBaselines: number[] = [];
    const result = extractTextPathData({
      lines: [{ text: "A", x: 3, y: 9.5546875 }],
      font: recordingFont(recordedBaselines),
      fontSize: 10,
      align: "LEFT",
    });

    expect(recordedBaselines).toEqual([9.5546875]);
    const command = result.glyphContours[0]?.commands[0];
    if (command?.type !== "M") {
      throw new Error("expected first glyph command");
    }
    expect(command).toEqual({ type: "M", x: 3, y: 9.5546875 });
  });
});

describe("createUnderlineRect", () => {
  it("anchors the underline to the same fractional baseline the font-driven path emit uses", () => {
    const rect = createUnderlineRect({
      text: "A",
      font: recordingFont([]),
      fontSize: 10,
      x: 3,
      y: 9.5546875,
      align: "LEFT",
    });

    // recordingFont ships no `post` table, so the underline falls
    // back to the canonical ratios (position = 0.15 × fontSize,
    // thickness = 0.05 × fontSize). The rectangle TOP sits at
    // `baseline + positionPx + thicknessPx / 2` per the empirical
    // Figma-export rule documented in `createUnderlineRect`.
    //   positionPx = 10 × 0.15 = 1.5
    //   thicknessPx = 10 × 0.05 = 0.5
    //   y_top = 9.5546875 + 1.5 + 0.25 = 11.3046875
    expect(rect).toEqual({
      x: 3,
      y: 11.3046875,
      width: 10,
      height: 0.5,
    });
  });
});
