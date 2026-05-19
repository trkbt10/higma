/**
 * @file Case `hero-image-with-text` — landing hero with bg image, h1
 * headline, and a chrome-bearing CTA button. Asserts the
 * three-piece structural decomposition.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { CTA_LABEL, HEADLINE_TEXT, heroImageWithText } from "./fixture";

describe("case hero-image-with-text", () => {
  const ir = normalizeOne(heroImageWithText());
  const hero = asFrame(singleChild(ir));

  it("captures at least one fill on the hero (background-image / background-color)", () => {
    expect(hero.style.fills.length).toBeGreaterThan(0);
  });

  it("collapses the `<h1>` headline to a TEXT carrying the headline verbatim", () => {
    const h1 = hero.children[0];
    if (!h1 || h1.kind !== "text") {
      throw new Error("expected h1 text");
    }
    expect(h1.characters).toBe(HEADLINE_TEXT);
  });

  it("promotes the chrome-bearing `<button>` to a FRAME wrapping a TEXT", () => {
    const cta = hero.children[1];
    if (!cta || cta.kind !== "frame") {
      throw new Error("expected cta to be a chrome FRAME");
    }
    expect(cta.children).toHaveLength(1);
    const label = cta.children[0];
    if (!label || label.kind !== "text") {
      throw new Error("expected label text inside cta frame");
    }
    expect(label.characters).toBe(CTA_LABEL);
  });

  it("preserves the CTA's authored corner radius on the chrome FRAME", () => {
    const cta = hero.children[1];
    if (!cta || cta.kind !== "frame") {
      throw new Error("expected cta frame");
    }
    expect(cta.style.cornerRadius).toBeDefined();
  });
});
