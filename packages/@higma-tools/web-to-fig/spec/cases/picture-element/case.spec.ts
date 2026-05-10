/**
 * @file Case `picture-element` — `<picture>` wraps an `<img>`; the
 * inner img carries the resolved imageId. Normaliser must reach the
 * inner img without losing the resolved asset.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { RESOLVED_IMAGE_ID, pictureWithImg } from "./fixture";

describe("case picture-element", () => {
  const picture = asFrame(singleChild(normalizeOne(pictureWithImg())));

  it("preserves the inner <img> as a child", () => {
    expect(picture.children).toHaveLength(1);
  });

  it("inner img carries the resolved imageId as an image PaintIR", () => {
    const img = picture.children[0]!;
    if (img.kind !== "frame") {
      throw new Error("expected inner img frame");
    }
    const fill = img.style.fills.find((f) => f.kind === "image");
    if (!fill || fill.kind !== "image") {
      throw new Error("expected image paint on inner img");
    }
    expect(fill.imageId).toBe(RESOLVED_IMAGE_ID);
  });
});
