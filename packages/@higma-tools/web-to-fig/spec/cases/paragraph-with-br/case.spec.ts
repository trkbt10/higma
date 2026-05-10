/**
 * @file Case `paragraph-with-br` — `<br>` inside a paragraph yields
 * a literal `\n` between the two text fragments. Without the break
 * the paragraph collapses to one line and the visual output is wrong.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { EXPECTED_TEXT_WITH_BREAK, paragraphWithBr } from "./fixture";

describe("case paragraph-with-br", () => {
  it("inserts a newline at the `<br>` position", () => {
    const text = asText(singleChild(normalizeOne(paragraphWithBr())));
    expect(text.characters).toBe(EXPECTED_TEXT_WITH_BREAK);
  });
});
