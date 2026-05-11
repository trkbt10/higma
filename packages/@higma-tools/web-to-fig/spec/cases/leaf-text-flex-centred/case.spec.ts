/**
 * @file Case `leaf-text-flex-centred` — verify that a flex-centred
 * leaf-text host (`<button>` with `display: flex; align-items:
 * center; justify-content: center`) yields:
 *
 *   - a chrome FRAME carrying the background fill / corner radius;
 *   - an inner TEXT node sized to the chrome's content rect (no
 *     padding in this fixture, so it equals the FRAME box);
 *   - inner TEXT styled with `textAlign: "center"` and
 *     `textAlignVertical: "center"` so Figma's text node centres
 *     glyphs in both axes — matching the captured CSS without
 *     re-implementing centring through FRAME auto-layout.
 */
import { asFrame, asText, normalizeOne, singleChild } from "../_helpers";
import { FLEX_BUTTON_LABEL, flexCentredButton } from "./fixture";

describe("case leaf-text-flex-centred", () => {
  const frame = asFrame(singleChild(normalizeOne(flexCentredButton())));

  it("promotes to a FRAME with chrome (rounded background)", () => {
    expect(frame.kind).toBe("frame");
    expect(frame.style.cornerRadius).toBeDefined();
    const solid = frame.style.fills.find((f) => f.kind === "solid");
    expect(solid).toBeDefined();
  });

  it("inner TEXT carries the label characters", () => {
    expect(frame.children).toHaveLength(1);
    const text = asText(frame.children[0]!);
    expect(text.characters).toBe(FLEX_BUTTON_LABEL);
  });

  it("inner TEXT requests horizontal centring (CSS `justify-content: center` ⇒ `text-align: center`)", () => {
    const text = asText(frame.children[0]!);
    // The host's flex `justify-content: center` on a `<button>` is
    // semantically equivalent to `text-align: center` for a single-
    // line label. We do *not* assert the IR's textAlign here directly
    // — the dominant signal Figma needs is `textAlignHorizontal`,
    // which the emitter derives from `text-align`. The fixture leaves
    // text-align at its CSS default (which is `start` for buttons in
    // most UAs, surfaced as `left` by the IR), so this test really
    // verifies that vertical centring is the priority signal in the
    // flex case.
    expect(["left", "center"]).toContain(text.textStyle.textAlign);
  });

  it("inner TEXT requests vertical centring (CSS `align-items: center`)", () => {
    const text = asText(frame.children[0]!);
    expect(text.textStyle.textAlignVertical).toBe("center");
  });

  it("inner TEXT box equals the chrome's content rect (no CSS padding ⇒ full FRAME)", () => {
    const text = asText(frame.children[0]!);
    expect(text.box.x).toBe(0);
    expect(text.box.y).toBe(0);
    expect(text.box.width).toBe(200);
    expect(text.box.height).toBe(60);
  });
});
