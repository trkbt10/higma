/**
 * @file `iframe-embed` — `<iframe src="...">`. The browser draws
 * arbitrary remote content inside the iframe's bbox. The IR can't
 * reproduce that content, but it should at least preserve the iframe
 * as a placeholder FRAME at the right geometry.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const IFRAME_RECT = { x: 0, y: 0, width: 320, height: 240 };

/** `<iframe>` placeholder with a light-grey background. */
export function iframeEmbed(): RawElement {
  return synthEl({
    id: "iframe",
    tag: "iframe",
    rect: IFRAME_RECT,
    styleOverrides: {
      "background-color": "rgb(245, 245, 245)",
    },
  });
}
