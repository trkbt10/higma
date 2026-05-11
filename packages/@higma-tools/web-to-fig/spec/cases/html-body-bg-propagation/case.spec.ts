/**
 * @file Case `html-body-bg-propagation` — when `<body>` carries the page
 * background colour and `<html>` does not, the canvas paints the body
 * colour across the entire viewport (CSS 2.1 §14.2). The IR's root
 * frame must carry that fill — otherwise the rendered `.fig` shows the
 * body colour only behind the body's narrow rect and the rest of the
 * viewport remains transparent / white. That is the dominant failure
 * mode the `example-com-fullpage` diff currently exposes (yellow halo
 * on every glyph, white margins).
 *
 * The case is intentionally tiny: one synthetic body-shaped child of
 * the viewport root, no other styling. A regression here is unambiguous.
 */
import { normalizeViewport } from "../../../src/normalize";
import { synthViewport } from "../../synth-snapshot";
import { staticFontResolver } from "../../test-font-resolver";
import { asFrame } from "../_helpers";
import { BODY_BG, bodyWithBg } from "./fixture";

describe("case html-body-bg-propagation", () => {
  it("propagates `<body>` background to the root frame fill when `<html>` has none", () => {
    const ir = normalizeViewport(
      synthViewport({
        background: BODY_BG, // the page background the in-page walker captures
        children: [bodyWithBg()],
      }),
      { fontResolver: staticFontResolver() },
    );
    const root = asFrame(ir.root);
    // Root frame must paint the viewport — otherwise everything outside
    // the body's narrow rect renders transparent in the `.fig`.
    expect(root.style.fills.length).toBeGreaterThanOrEqual(1);
    const solid = root.style.fills.find((f) => f.kind === "solid");
    if (solid === undefined || solid.kind !== "solid") {
      throw new Error("expected a solid fill on root frame");
    }
    expect(Math.round(solid.color.r * 255)).toBe(238);
    expect(Math.round(solid.color.g * 255)).toBe(238);
    expect(Math.round(solid.color.b * 255)).toBe(238);
    expect(solid.color.a).toBe(1);
  });

  it("root frame extends to the full viewport, not the body's narrow rect", () => {
    const ir = normalizeViewport(
      synthViewport({
        background: BODY_BG,
        children: [bodyWithBg()],
      }),
      { fontResolver: staticFontResolver() },
    );
    const root = asFrame(ir.root);
    expect(root.box.x).toBe(0);
    expect(root.box.y).toBe(0);
    expect(root.box.width).toBe(1280);
    expect(root.box.height).toBe(800);
  });
});
