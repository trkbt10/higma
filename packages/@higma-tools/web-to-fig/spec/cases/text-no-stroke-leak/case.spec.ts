/**
 * @file Case `text-no-stroke-leak` — verify that a paragraph host's
 * `border-bottom` does NOT surface on the resulting TEXT node's
 * `style.strokes`. Figma TEXT has no border surface; leaking the
 * captured border there renders as glyph-outline strokes (the
 * regression this case prevents).
 */
import { asText, normalizeOne, singleChild } from "../_helpers";
import { paragraphWithBorder } from "./fixture";

describe("case text-no-stroke-leak", () => {
  const text = asText(singleChild(normalizeOne(paragraphWithBorder())));

  it("emits a TEXT node (paragraph host with inline children collapses to a single TEXT)", () => {
    expect(text.kind).toBe("text");
  });

  it("does NOT carry the captured `border-bottom` as a stroke", () => {
    expect(text.style.strokes).toEqual([]);
  });

  it("does NOT carry a corner-radius (TEXT has no corner surface)", () => {
    expect(text.style.cornerRadius).toBeUndefined();
  });

  it("does NOT enable clipsContent (TEXT does not own a clip rect)", () => {
    expect(text.style.clipsContent).toBe(false);
  });

  it("preserves the glyph fill from CSS color", () => {
    expect(text.style.fills).toHaveLength(1);
    const fill = text.style.fills[0]!;
    if (fill.kind !== "solid") {
      throw new Error("expected SOLID glyph fill");
    }
    expect(fill.color.r).toBeCloseTo(20 / 255, 3);
    expect(fill.color.g).toBeCloseTo(30 / 255, 3);
    expect(fill.color.b).toBeCloseTo(40 / 255, 3);
  });
});
