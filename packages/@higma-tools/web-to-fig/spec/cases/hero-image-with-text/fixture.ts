/**
 * @file `hero-image-with-text` — landing-page hero pattern: a tall
 * `<section>` with a full-bleed `background-image`, an `<h1>`
 * headline overlaid, and a CTA `<button>` below.
 *
 * Two background paint sources interact: the hero's
 * `background-image` and `background-color` (fallback). The IR must
 * capture the `background-image` as a paint on the FRAME (image
 * fill); the `<h1>` and CTA become FRAME / TEXT children rendered
 * on top.
 *
 * The case asserts:
 *   - The hero has at least one fill in its IR (the bg image).
 *   - The headline collapses to a TEXT carrying the headline.
 *   - The CTA is promoted to a FRAME-wrapping-TEXT (chrome from
 *     `background-color`).
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const HERO_RECT: RawRect = { x: 0, y: 0, width: 1200, height: 480 };
export const HERO_IMAGE_ID = "hero-bg";
export const HEADLINE_TEXT = "Build the future";
export const CTA_LABEL = "Get started";

/** Build a hero `<section>` with a bg image, an `<h1>` headline, and a CTA `<button>`. */
export function heroImageWithText(): RawElement {
  const headline = synthEl({
    id: "hero/h1",
    tag: "h1",
    rect: { x: 100, y: 200, width: 600, height: 64 },
    styleOverrides: {
      display: "block",
      color: "rgb(255, 255, 255)",
      "font-size": "48px",
      "font-weight": "700",
    },
    text: HEADLINE_TEXT,
  });
  const cta = synthEl({
    id: "hero/cta",
    tag: "button",
    rect: { x: 100, y: 296, width: 160, height: 48 },
    styleOverrides: {
      "background-color": "rgb(0, 102, 204)",
      color: "rgb(255, 255, 255)",
      "font-size": "16px",
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
      "padding-left": "24px",
      "padding-right": "24px",
    },
    text: CTA_LABEL,
  });
  return synthEl({
    id: "hero",
    tag: "section",
    rect: HERO_RECT,
    contentRect: HERO_RECT,
    styleOverrides: {
      display: "block",
      "background-color": "rgb(20, 20, 30)",
      "background-image": `url("./hero-bg.jpg")`,
      "background-size": "cover",
      "background-position": "center center",
    },
    imageId: HERO_IMAGE_ID,
    imageIds: [HERO_IMAGE_ID],
    children: [headline, cta],
  });
}
