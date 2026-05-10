/**
 * @file `image-bg-tile` — apply a tiled `background-image: url(...)`
 * to a `RawElement` and register the matching `imageId(s)`.
 *
 * "Tile" is the safe primitive for image-paint coverage: it has a
 * direct 1-to-1 mapping to Figma's TILE scaleMode and avoids both the
 * natural-size synth path (`auto` + `no-repeat`) and the cover/contain
 * branches. Those edge cases are out of scope for this primitive and
 * will get their own cases when needed.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_IMAGE_ID = "img-tile-1";
export const DEFAULT_IMAGE_URL = `url("https://example.com/${DEFAULT_IMAGE_ID}.png")`;

/** Apply a tiled `background-image: url(...) repeat` and register the imageId. */
export function withTiledBgImage(
  el: RawElement,
  imageId: string = DEFAULT_IMAGE_ID,
  url: string = DEFAULT_IMAGE_URL,
): RawElement {
  return {
    ...el,
    imageId,
    imageIds: [imageId],
    computedStyle: {
      ...el.computedStyle,
      "background-image": url,
      "background-repeat": "repeat",
      "background-size": "auto",
    },
  };
}
