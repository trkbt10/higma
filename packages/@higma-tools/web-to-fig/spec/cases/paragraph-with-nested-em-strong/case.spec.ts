/**
 * @file Case `paragraph-with-nested-em-strong` — paragraph collapse
 * must preserve italic AND bold runs at the right character ranges.
 */
import { asText, normalizeOne, singleChild } from "../case-ir-assertions";
import {
  AUTHOR,
  MIDDLE,
  PREFIX,
  SUFFIX,
  TITLE,
  paragraphWithEmAndStrong,
} from "./fixture";

describe("case paragraph-with-nested-em-strong", () => {
  const ir = normalizeOne(paragraphWithEmAndStrong());
  const text = asText(singleChild(ir));

  it("interleaves prose, italic, and bold in document order", () => {
    expect(text.characters).toBe(`${PREFIX}${TITLE}${MIDDLE}${AUTHOR}${SUFFIX}`);
  });

  it("emits one run for the italic span and one for the bold span", () => {
    const runs = text.runs ?? [];
    expect(runs).toHaveLength(2);
  });

  it("encodes italic on the title range with no fontWeight deviation", () => {
    const runs = text.runs ?? [];
    if (runs.length < 1) {
      throw new Error("expected an italic run");
    }
    const titleStart = PREFIX.length;
    const titleEnd = titleStart + TITLE.length;
    const italicRun = runs[0]!;
    expect(italicRun.start).toBe(titleStart);
    expect(italicRun.end).toBe(titleEnd);
    expect(italicRun.fontStyle).toBe("italic");
    expect(italicRun.fontWeight).toBeUndefined();
  });

  it("encodes bold on the author range with no fontStyle deviation", () => {
    const runs = text.runs ?? [];
    if (runs.length < 2) {
      throw new Error("expected a bold run");
    }
    const authorStart = PREFIX.length + TITLE.length + MIDDLE.length;
    const authorEnd = authorStart + AUTHOR.length;
    const boldRun = runs[1]!;
    expect(boldRun.start).toBe(authorStart);
    expect(boldRun.end).toBe(authorEnd);
    expect(boldRun.fontWeight).toBe(700);
    expect(boldRun.fontStyle).toBeUndefined();
  });
});
