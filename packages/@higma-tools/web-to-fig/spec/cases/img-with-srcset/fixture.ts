/**
 * @file `img-with-srcset` — `<img srcset="...">` resolves to one of
 * the candidates at capture time. The resulting `RawElement` carries
 * the resolved `imageId` exactly as a single-src `<img>` would.
 *
 * The case asserts the IR doesn't care about `srcset` itself — it
 * just consumes the resolved `imageId`. This proves the capture
 * boundary is doing the resolution, not the normaliser.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const RESOLVED_IMAGE_ID = "img-srcset-resolved";

/** `<img>` carrying a pre-resolved imageId (the capture has already picked from srcset). */
export function imgWithSrcset(): RawElement {
  return synthEl({
    id: "img",
    tag: "img",
    rect: { x: 0, y: 0, width: 200, height: 100 },
    imageId: RESOLVED_IMAGE_ID,
    imageIds: [RESOLVED_IMAGE_ID],
  });
}
