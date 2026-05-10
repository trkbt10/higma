/**
 * @file `picture-element` — `<picture><source><img></picture>`. The
 * browser picks one `<source>` and the resulting `<img>` inside has
 * the resolved imageId. From the IR's perspective the `<picture>`
 * wrapper is just a container with one inline-img child — the same
 * shape as `<img>` for normalisation purposes.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const RESOLVED_IMAGE_ID = "picture-resolved";

/** `<picture>` wrapping an `<img>` with the resolved imageId. */
export function pictureWithImg(): RawElement {
  const innerImg = synthEl({
    id: "picture/img",
    tag: "img",
    rect: { x: 0, y: 0, width: 320, height: 200 },
    imageId: RESOLVED_IMAGE_ID,
    imageIds: [RESOLVED_IMAGE_ID],
  });
  return synthEl({
    id: "picture",
    tag: "picture",
    rect: { x: 0, y: 0, width: 320, height: 200 },
    children: [innerImg],
  });
}
