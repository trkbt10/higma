/** @file Corner radius domain tests. */

import { sectionNode } from "../section-specimen";
import { readUniformCornerRadius } from "./corner-radius-domain";

describe("readUniformCornerRadius", () => {
  it("reads a scalar cornerRadius before per-corner data", () => {
    expect(readUniformCornerRadius(sectionNode("RECTANGLE", { cornerRadius: 6, rectangleCornerRadii: [1, 1, 1, 1] }))).toBe(6);
  });

  it("reads uniform rectangleCornerRadii and rejects mixed radii", () => {
    expect(readUniformCornerRadius(sectionNode("RECTANGLE", { rectangleCornerRadii: [4, 4, 4, 4] }))).toBe(4);
    expect(readUniformCornerRadius(sectionNode("RECTANGLE", { rectangleCornerRadii: [1, 2, 3, 4] }))).toBeUndefined();
  });
});
