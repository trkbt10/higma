/**
 * @file Case `description-list` — `<dl>` with one `<dt>` and one `<dd>`
 * must stay a FRAME with two TEXT children, regardless of the
 * non-mainstream tag names.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { DESC, TERM, descriptionList } from "./fixture";

describe("case description-list", () => {
  const ir = normalizeOne(descriptionList());
  const dl = asFrame(singleChild(ir));

  it("keeps the `<dl>` as a FRAME (block-level wrapper, not paragraph host)", () => {
    expect(dl.kind).toBe("frame");
  });

  it("preserves both the `<dt>` and the `<dd>`", () => {
    expect(dl.children).toHaveLength(2);
  });

  it("collapses the `<dt>` to a TEXT carrying the term verbatim", () => {
    const dt = dl.children[0];
    if (!dt || dt.kind !== "text") {
      throw new Error("expected <dt> to be a text");
    }
    expect(dt.characters).toBe(TERM);
  });

  it("collapses the `<dd>` to a TEXT carrying the description verbatim", () => {
    const dd = dl.children[1];
    if (!dd || dd.kind !== "text") {
      throw new Error("expected <dd> to be a text");
    }
    expect(dd.characters).toBe(DESC);
  });
});
