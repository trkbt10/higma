/**
 * @file Spec — `figmaFontToQuery` ↔ `fontQueryToStyleName` round-trip
 * symmetry. The two functions are the SoT for converting between
 * Figma `fontName.style` strings and the canonical `FontQuery`; if
 * they ever drift, every web-to-fig emit will silently corrupt
 * weight metadata.
 */
import { figmaFontToQuery, fontQueryToStyleName, type FontQuery } from "./query";
import { FONT_WEIGHTS } from "./weight";

const STANDARD_LABELS: readonly { weight: number; label: string }[] = [
  { weight: FONT_WEIGHTS.THIN, label: "Thin" },
  { weight: FONT_WEIGHTS.EXTRA_LIGHT, label: "ExtraLight" },
  { weight: FONT_WEIGHTS.LIGHT, label: "Light" },
  { weight: FONT_WEIGHTS.REGULAR, label: "Regular" },
  { weight: FONT_WEIGHTS.MEDIUM, label: "Medium" },
  { weight: FONT_WEIGHTS.SEMI_BOLD, label: "SemiBold" },
  { weight: FONT_WEIGHTS.BOLD, label: "Bold" },
  { weight: FONT_WEIGHTS.EXTRA_BOLD, label: "ExtraBold" },
  { weight: FONT_WEIGHTS.BLACK, label: "Black" },
];

describe("fontQueryToStyleName", () => {
  it("emits the canonical label for every standard weight", () => {
    for (const { weight, label } of STANDARD_LABELS) {
      const out = fontQueryToStyleName({ family: "Inter", weight: weight as FontQuery["weight"], style: "normal" });
      expect(out).toBe(label);
    }
  });

  it("appends ' Italic' to non-Regular labels for italic style", () => {
    expect(fontQueryToStyleName({ family: "Inter", weight: FONT_WEIGHTS.BOLD, style: "italic" })).toBe("Bold Italic");
    expect(fontQueryToStyleName({ family: "Inter", weight: FONT_WEIGHTS.LIGHT, style: "italic" })).toBe("Light Italic");
  });

  it("collapses Regular + italic to plain 'Italic'", () => {
    expect(fontQueryToStyleName({ family: "Inter", weight: FONT_WEIGHTS.REGULAR, style: "italic" })).toBe("Italic");
  });

  it("treats oblique as italic for label emission (Figma fontName has no oblique)", () => {
    expect(fontQueryToStyleName({ family: "Inter", weight: FONT_WEIGHTS.BOLD, style: "oblique" })).toBe("Bold Italic");
  });

  it("round-trips through figmaFontToQuery for every standard upright label", () => {
    for (const { weight, label } of STANDARD_LABELS) {
      const back = figmaFontToQuery({ family: "Inter", style: label });
      expect(back.weight).toBe(weight);
      expect(back.style).toBe("normal");
    }
  });

  it("round-trips through figmaFontToQuery for every standard italic label", () => {
    for (const { weight } of STANDARD_LABELS) {
      const forward = fontQueryToStyleName({ family: "Inter", weight: weight as FontQuery["weight"], style: "italic" });
      const back = figmaFontToQuery({ family: "Inter", style: forward });
      expect(back.weight).toBe(weight);
      expect(back.style).toBe("italic");
    }
  });
});
