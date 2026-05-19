/**
 * @file Case `text-line-height-ratio` — unitless line-height becomes
 * `{ unit: "ratio", value }` in IR.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { DEFAULT_LINE_HEIGHT_RATIO, textLeafWithRatioLineHeight } from "./fixture";

describe("case text-line-height-ratio", () => {
  it("encodes the ratio with `unit: ratio` (no resolution to px)", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithRatioLineHeight())));
    expect(text.textStyle.lineHeight).toEqual({ unit: "ratio", value: DEFAULT_LINE_HEIGHT_RATIO });
  });
});
