/**
 * @file Case `text-line-height-px` — explicit px line-height becomes
 * `{ unit: "px", value }` in IR.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { DEFAULT_LINE_HEIGHT_PX, textLeafWithPxLineHeight } from "./fixture";

describe("case text-line-height-px", () => {
  it("encodes the px line-height with `unit: px`", () => {
    const text = asText(singleChild(normalizeOne(textLeafWithPxLineHeight())));
    expect(text.textStyle.lineHeight).toEqual({ unit: "px", value: DEFAULT_LINE_HEIGHT_PX });
  });
});
