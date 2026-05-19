/**
 * @file Case `custom-element-frame` — unknown tag names (Polymer /
 * web-components) must walk the FRAME path with all children
 * preserved. Asserts the normaliser is tag-agnostic at the structure
 * level.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { CHILD_COUNT, HOST_RECT, customElementFrame } from "./fixture";

describe("case custom-element-frame", () => {
  const ir = normalizeOne(customElementFrame());
  const host = asFrame(singleChild(ir));

  it("emits a FRAME for the unknown custom-element tag", () => {
    expect(host.kind).toBe("frame");
  });

  it("preserves the host's captured rect", () => {
    expect(host.box.width).toBe(HOST_RECT.width);
    expect(host.box.height).toBe(HOST_RECT.height);
  });

  it("preserves all children of the custom element", () => {
    expect(host.children).toHaveLength(CHILD_COUNT);
  });
});
