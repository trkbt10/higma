/**
 * @file Case `iframe-embed` — `<iframe>` is preserved as a FRAME
 * placeholder at its bbox.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { IFRAME_RECT, iframeEmbed } from "./fixture";

describe("case iframe-embed", () => {
  const frame = asFrame(singleChild(normalizeOne(iframeEmbed())));

  it("becomes a FRAME at the iframe's bbox", () => {
    expect(frame.box).toEqual(IFRAME_RECT);
  });

  it("preserves the placeholder background colour", () => {
    expect(frame.style.fills).toHaveLength(1);
  });
});
