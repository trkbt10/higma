/**
 * @file Case `nested-ul-list` — outer `<li>` with a nested `<ul>` must
 * stay a FRAME (not collapse to TEXT). Inner leaf-text `<li>`
 * collapses to a TEXT IR.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import {
  NESTED_LI_TEXT,
  nestedUnorderedList,
} from "./fixture";

describe("case nested-ul-list", () => {
  const ir = normalizeOne(nestedUnorderedList());
  const ulRoot = asFrame(singleChild(ir));

  it("preserves the top-level `<ul>` as a FRAME with one `<li>` child", () => {
    expect(ulRoot.children).toHaveLength(1);
  });

  it("keeps the outer `<li>` (containing a nested block) as a FRAME, NOT a TEXT", () => {
    const outerLi = ulRoot.children[0]!;
    expect(outerLi.kind).toBe("frame");
  });

  it("collapses the inner leaf-text `<li>` to a TEXT IR with the right characters", () => {
    const outerLi = ulRoot.children[0];
    if (!outerLi || outerLi.kind !== "frame") {
      throw new Error("expected outer <li> to be a frame");
    }
    const innerUl = outerLi.children[outerLi.children.length - 1];
    if (!innerUl || innerUl.kind !== "frame") {
      throw new Error("expected nested <ul> to be a frame");
    }
    const innerLi = innerUl.children[0];
    if (!innerLi || innerLi.kind !== "text") {
      throw new Error("expected nested <li> to be a text");
    }
    expect(innerLi.characters).toBe(NESTED_LI_TEXT);
  });
});
