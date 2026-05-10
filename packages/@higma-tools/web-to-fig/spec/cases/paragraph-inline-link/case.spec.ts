/**
 * @file Case `paragraph-inline-link` — paragraph host collapses into
 * one TEXT IR; the anchor surfaces as a `TextRunIR` over its character
 * range with the link colour and underline.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { LINK_TEXT, PARAGRAPH_TEXT, paragraphWithInlineLink } from "./fixture";

describe("case paragraph-inline-link", () => {
  const text = asText(singleChild(normalizeOne(paragraphWithInlineLink())));

  it("collapses the paragraph and inline child into a single TEXT", () => {
    expect(text.kind).toBe("text");
    expect(text.characters).toBe(PARAGRAPH_TEXT);
  });

  it("emits exactly one styled run for the anchor", () => {
    expect(text.runs).toBeDefined();
    expect(text.runs!.length).toBe(1);
  });

  it("the run covers the anchor's character range", () => {
    const run = text.runs![0]!;
    expect(text.characters.slice(run.start, run.end)).toBe(LINK_TEXT);
  });

  it("the run carries the link colour and underline override", () => {
    const run = text.runs![0]!;
    expect(run.color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    expect(run.textDecoration).toBe("underline");
  });
});
