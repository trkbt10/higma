/**
 * @file Case `pseudo-after-arrow` — `::after` glyph appends after host text.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { ARROW, LINK_TEXT, anchorWithAfterArrow } from "./fixture";

describe("case pseudo-after-arrow", () => {
  it("appends the ::after content to the host's text", () => {
    const text = asText(singleChild(normalizeOne(anchorWithAfterArrow())));
    expect(text.characters).toBe(LINK_TEXT + ARROW);
  });
});
