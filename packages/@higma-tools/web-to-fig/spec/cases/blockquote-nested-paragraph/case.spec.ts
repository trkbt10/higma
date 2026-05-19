/**
 * @file Case `blockquote-nested-paragraph` — `<blockquote>` with a
 * single `<p>` child must stay a FRAME, NOT collapse to a TEXT IR.
 * The inner `<p>` is the actual paragraph host.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { QUOTE_TEXT, blockquoteWithNestedParagraph } from "./fixture";

describe("case blockquote-nested-paragraph", () => {
  const ir = normalizeOne(blockquoteWithNestedParagraph());
  const quote = asFrame(singleChild(ir));

  it("keeps the `<blockquote>` as a FRAME (not paragraph collapse)", () => {
    expect(quote.kind).toBe("frame");
  });

  it("preserves exactly one child (the `<p>`)", () => {
    expect(quote.children).toHaveLength(1);
  });

  it("collapses the inner `<p>` to a TEXT carrying the quote verbatim", () => {
    const para = quote.children[0];
    if (!para || para.kind !== "text") {
      throw new Error("expected inner <p> to be a text");
    }
    expect(para.characters).toBe(QUOTE_TEXT);
  });
});
