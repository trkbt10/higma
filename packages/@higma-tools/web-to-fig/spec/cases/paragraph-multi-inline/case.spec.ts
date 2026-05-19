/**
 * @file Case `paragraph-multi-inline` — paragraph with two inline
 * children of distinct styles produces two TextRunIRs in document
 * order, each over its own character range.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import { PARAGRAPH_TEXT, paragraphMultiInline } from "./fixture";

describe("case paragraph-multi-inline", () => {
  const text = asText(singleChild(normalizeOne(paragraphMultiInline())));

  it("concatenates direct text + inline children in document order", () => {
    expect(text.characters).toBe(PARAGRAPH_TEXT);
  });

  it("emits one run per styled inline child", () => {
    expect(text.runs).toBeDefined();
    expect(text.runs!.length).toBe(2);
  });

  it("first run covers `bar` with bold weight override", () => {
    const r = text.runs![0]!;
    expect(text.characters.slice(r.start, r.end)).toBe("bar");
    expect(r.fontWeight).toBe(700);
  });

  it("second run covers `qux` with italic style override", () => {
    const r = text.runs![1]!;
    expect(text.characters.slice(r.start, r.end)).toBe("qux");
    expect(r.fontStyle).toBe("italic");
  });
});
