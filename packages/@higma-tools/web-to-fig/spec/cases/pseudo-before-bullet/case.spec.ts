/**
 * @file Case `pseudo-before-bullet` — the `::before` glyph prepends
 * the host's text in the resulting TEXT IR.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { BULLET, ITEM_TEXT, liWithBeforeBullet } from "./fixture";

describe("case pseudo-before-bullet", () => {
  it("prepends the ::before content to the host's text", () => {
    const text = asText(singleChild(normalizeOne(liWithBeforeBullet())));
    expect(text.characters).toBe(BULLET + ITEM_TEXT);
  });
});
