/**
 * @file Pin the multi-line line-height stride contract.
 *
 * Figma's `derivedTextData.baselines[0].lineHeight` is the line *box*
 * height — `max(authored line-height, the font's natural line box)` —
 * not the rendered per-line stride. When a heading packs lines tighter
 * than the font's natural box (a 56 px Noto Sans JP heading at a 1.2
 * multiplier renders a 67 px stride while the natural box is ~81 px),
 * using the box height as `line-height` spreads every line apart and
 * pushes the whole text block downward. The authoritative stride is
 * the baseline-to-baseline `lineY` delta; `readDerivedBaselineLineHeight`
 * returns that for multi-line text and falls back to the box height
 * only for single-line text (which has no stride).
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { readDerivedBaselineLineHeight } from "./style";

function textNodeWithBaselines(
  baselines: ReadonlyArray<{ lineHeight?: number; lineY?: number }>,
): FigNode {
  return { derivedTextData: { baselines } } as unknown as FigNode;
}

describe("readDerivedBaselineLineHeight", () => {
  it("returns the baseline-to-baseline stride for multi-line text packed tighter than the natural box", () => {
    // 56 px heading at a 1.2 multiplier: stride 67, natural box 81.088.
    const node = textNodeWithBaselines([
      { lineY: 0, lineHeight: 81.088 },
      { lineY: 67, lineHeight: 81.088 },
      { lineY: 134, lineHeight: 81.088 },
    ]);
    expect(readDerivedBaselineLineHeight(node)).toBe(67);
  });

  it("returns the stride even when the box height equals the stride (loose line-height)", () => {
    // 42 px heading at a 1.5 multiplier: stride 63, box height 63.
    const node = textNodeWithBaselines([
      { lineY: 0, lineHeight: 63 },
      { lineY: 63, lineHeight: 63 },
    ]);
    expect(readDerivedBaselineLineHeight(node)).toBe(63);
  });

  it("falls back to the box height for single-line text (no stride available)", () => {
    const node = textNodeWithBaselines([{ lineY: 0, lineHeight: 48 }]);
    expect(readDerivedBaselineLineHeight(node)).toBe(48);
  });

  it("falls back to the box height when the second baseline lacks a lineY", () => {
    const node = textNodeWithBaselines([
      { lineY: 0, lineHeight: 48 },
      { lineHeight: 48 },
    ]);
    expect(readDerivedBaselineLineHeight(node)).toBe(48);
  });

  it("returns undefined when there are no baselines", () => {
    expect(readDerivedBaselineLineHeight(textNodeWithBaselines([]))).toBeUndefined();
  });

  it("returns undefined when derivedTextData is absent", () => {
    expect(readDerivedBaselineLineHeight({} as unknown as FigNode)).toBeUndefined();
  });
});
