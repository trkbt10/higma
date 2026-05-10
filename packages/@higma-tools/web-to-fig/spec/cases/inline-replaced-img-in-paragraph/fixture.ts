/**
 * @file `inline-replaced-img-in-paragraph` — `<p>Look <img src=...>!</p>`.
 *
 * `<img>` inside a paragraph is an inline-replaced element. Browsers
 * lay it out inline with the surrounding text, but the IR can't put
 * an image in the middle of a TextRunIR — there's no representation
 * for "image at character index 5".
 *
 * The honest contract:
 *   - the paragraph host does NOT collapse to a single TEXT (because
 *     `<img>` is a replaced element, not pure inline text)
 *   - the resulting IR is a FRAME whose children include both the
 *     surrounding text and an image-paint child
 *
 * This is why `paragraph.ts` excludes REPLACED_INLINE_TAGS from
 * paragraph collapse.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

/** `<p>` containing only an `<img>` — paragraph collapse must NOT happen. */
export function paragraphWithInlineImg(): RawElement {
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 200, height: 24 },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px" },
    children: [
      synthEl({
        id: "p/img",
        tag: "img",
        rect: { x: 80, y: 0, width: 24, height: 24 },
        imageId: "icon",
        imageIds: ["icon"],
      }),
    ],
  });
}
