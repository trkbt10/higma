/**
 * @file Case `button-with-text` — `<button>` with direct text and CSS
 * chrome (background, corner radius, padding) becomes a FRAME holding
 * the chrome and a TEXT child holding the label. A bare TEXT IR
 * cannot carry chrome (Figma's TEXT has no background fill, no
 * corner radius, no border) — promoting to FRAME-wrapping-TEXT is
 * the only structurally faithful representation.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../_helpers";
import { BUTTON_LABEL, buttonWithText } from "./fixture";

describe("case button-with-text", () => {
  const frame = asFrame(singleChild(normalizeOne(buttonWithText())));

  it("promotes to a FRAME (not a bare TEXT)", () => {
    expect(frame.kind).toBe("frame");
  });

  it("FRAME carries the button background as a SOLID fill", () => {
    expect(frame.style.fills.length).toBeGreaterThanOrEqual(1);
    const solid = frame.style.fills.find((f) => f.kind === "solid");
    expect(solid).toBeDefined();
  });

  it("FRAME carries the authored corner radius", () => {
    expect(frame.style.cornerRadius).toBeDefined();
  });

  it("inner TEXT child carries the button label", () => {
    expect(frame.children).toHaveLength(1);
    const text = asText(frame.children[0]!);
    expect(text.characters).toBe(BUTTON_LABEL);
  });

  it("inner TEXT child does NOT duplicate the chrome (no corner radius, white glyph fill)", () => {
    const text = asText(frame.children[0]!);
    expect(text.style.cornerRadius).toBeUndefined();
    const solid = text.style.fills.find((f) => f.kind === "solid");
    if (!solid || solid.kind !== "solid") {
      throw new Error("expected glyph fill on inner TEXT");
    }
    // Fixture sets `color: rgb(255, 255, 255)` on the button.
    expect(solid.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });
});
