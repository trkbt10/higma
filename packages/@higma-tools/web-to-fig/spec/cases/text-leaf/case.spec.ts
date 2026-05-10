/**
 * @file Case `text-leaf` — leaf text with explicit font family / size /
 * weight / colour produces a TextNodeIR with the requested base style
 * and the colour landing on `style.fills` as a SOLID paint.
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_TEXT,
  textLeaf,
} from "./fixture";

describe("case text-leaf", () => {
  const text = asText(singleChild(normalizeOne(textLeaf())));

  it("emits a TEXT node carrying the literal characters", () => {
    expect(text.kind).toBe("text");
    expect(text.characters).toBe(DEFAULT_TEXT);
  });

  it("carries the authored font family / size / weight on textStyle", () => {
    expect(text.textStyle.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(text.textStyle.fontSize).toBe(DEFAULT_FONT_SIZE_PX);
    expect(text.textStyle.fontWeight).toBe(DEFAULT_FONT_WEIGHT);
  });

  it("text colour lands on `style.fills` as a SOLID paint", () => {
    expect(text.style.fills).toHaveLength(1);
    const fill = text.style.fills[0]!;
    if (fill.kind !== "solid") {
      throw new Error("expected SOLID text fill");
    }
    // DEFAULT_TEXT_COLOR is rgb(20, 30, 40).
    expect(fill.color.r).toBeCloseTo(20 / 255, 3);
    expect(fill.color.g).toBeCloseTo(30 / 255, 3);
    expect(fill.color.b).toBeCloseTo(40 / 255, 3);
  });

  it("strips quoted family fallbacks down to the first family name", () => {
    const text = asText(
      singleChild(normalizeOne(textLeaf({ fontFamily: '"Inter", "Helvetica", sans-serif' }))),
    );
    expect(text.textStyle.fontFamily).toBe("Inter");
  });
});
