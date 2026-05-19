/**
 * @file Case `floated-image-beside-text` — wrapper with a floated
 * `<figure>` and a paragraph must keep BOTH as siblings of a FRAME
 * IR. Paragraph collapse must NOT eat the wrapper (which would drop
 * the image entirely).
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { IMG_RECT, PROSE, floatedImageBesideText } from "./fixture";

describe("case floated-image-beside-text", () => {
  const ir = normalizeOne(floatedImageBesideText());
  const wrapper = asFrame(singleChild(ir));

  it("keeps the wrapper as a FRAME (no paragraph collapse)", () => {
    expect(wrapper.kind).toBe("frame");
  });

  it("preserves both the figure and the paragraph as siblings", () => {
    expect(wrapper.children).toHaveLength(2);
  });

  it("retains the floated image's captured rect", () => {
    const figure = wrapper.children[0];
    if (!figure || figure.kind !== "frame") {
      throw new Error("expected first child to be the figure FRAME");
    }
    expect(figure.box.x).toBe(IMG_RECT.x);
    expect(figure.box.width).toBe(IMG_RECT.width);
  });

  it("preserves the paragraph prose verbatim", () => {
    const para = wrapper.children[1];
    if (!para || para.kind !== "text") {
      throw new Error("expected second child to be a TEXT");
    }
    expect(para.characters).toBe(PROSE);
  });
});
