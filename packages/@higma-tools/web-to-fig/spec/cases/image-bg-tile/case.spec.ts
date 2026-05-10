/**
 * @file Case `image-bg-tile` — `background-image: url(...) repeat`
 * becomes a single image PaintIR with `scaleMode: "tile"` and
 * the imageId matches the registered asset.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_IMAGE_ID, withTiledBgImage } from "./fixture";

describe("case image-bg-tile", () => {
  const frame = asFrame(singleChild(normalizeOne(withTiledBgImage(baseDiv()))));

  it("emits a single fill", () => {
    expect(frame.style.fills).toHaveLength(1);
  });

  it("emits an `image` PaintIR with `scaleMode: tile`", () => {
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(fill.scaleMode).toBe("tile");
  });

  it("forwards the imageId verbatim", () => {
    const fill = frame.style.fills[0]!;
    if (fill.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(fill.imageId).toBe(DEFAULT_IMAGE_ID);
  });
});
