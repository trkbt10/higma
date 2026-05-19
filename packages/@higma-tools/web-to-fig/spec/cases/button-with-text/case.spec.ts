/**
 * @file Case `button-with-text` — `<button>` with direct text and CSS
 * chrome (background, corner radius, padding) becomes a FRAME holding
 * the chrome and a TEXT child holding the label. A bare TEXT IR
 * cannot carry chrome (Figma's TEXT has no background fill, no
 * corner radius, no border) — promoting to FRAME-wrapping-TEXT is
 * the only structurally faithful representation.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../case-ir-assertions";
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

  it("inner TEXT lives in the chrome's content rect (FRAME box minus padding)", () => {
    const text = asText(frame.children[0]!);
    // Fixture: 100×32 button with padding-left/right = 12px. The inner
    // content rect is therefore 76×32 (no vertical padding) starting
    // at x=12 from the FRAME's local origin.
    expect(text.box.x).toBe(12);
    expect(text.box.y).toBe(0);
    expect(text.box.width).toBe(76);
    expect(text.box.height).toBe(32);
  });

  it("inner TEXT promotes to vertical centring because the chrome is taller than one line stride", () => {
    const text = asText(frame.children[0]!);
    // Fixture: font-size 14, default line-height (~16.8px) ⇒ chrome
    // height 32 > 1.5 × stride. Leaf-text host should request CENTER.
    expect(text.textStyle.textAlignVertical).toBe("center");
  });
});
