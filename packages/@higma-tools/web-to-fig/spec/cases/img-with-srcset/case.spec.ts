/**
 * @file Case `img-with-srcset` — IR consumes the resolved imageId
 * verbatim; the normaliser doesn't need srcset awareness.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { RESOLVED_IMAGE_ID, imgWithSrcset } from "./fixture";

describe("case img-with-srcset", () => {
  const frame = asFrame(singleChild(normalizeOne(imgWithSrcset())));

  it("emits an image PaintIR carrying the resolved imageId", () => {
    const fill = frame.style.fills.find((f) => f.kind === "image");
    if (!fill || fill.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(fill.imageId).toBe(RESOLVED_IMAGE_ID);
  });
});
