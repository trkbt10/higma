/**
 * @file Case `inline-replaced-img-in-paragraph` — paragraph hosting
 * an `<img>` does not collapse to a single TEXT. The result is a
 * FRAME containing the image as a child.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { paragraphWithInlineImg } from "./fixture";

describe("case inline-replaced-img-in-paragraph", () => {
  const frame = asFrame(singleChild(normalizeOne(paragraphWithInlineImg())));

  it("does NOT collapse to a TEXT (the img would be lost)", () => {
    expect(frame.kind).toBe("frame");
  });

  it("the img child survives as a frame with an image fill", () => {
    expect(frame.children).toHaveLength(1);
    const img = frame.children[0]!;
    expect(img.kind).toBe("frame");
    if (img.kind !== "frame") {
      throw new Error("");
    }
    const imagePaint = img.style.fills.find((f) => f.kind === "image");
    expect(imagePaint).toBeDefined();
  });
});
