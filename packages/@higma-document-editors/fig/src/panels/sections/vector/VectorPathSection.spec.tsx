/** @file Vector path section tests. */

import { createElement } from "react";
import { renderSection, sectionNode } from "../section-specimen";
import { VectorPathSection } from "./VectorPathSection";

describe("VectorPathSection", () => {
  it("renders explicit Kiwi vector path data", () => {
    const node = sectionNode("VECTOR", {
      vectorPaths: [{ windingRule: "NONZERO", data: "M 0 0 L 10 0 Z" }],
    });
    const html = renderSection(createElement(VectorPathSection, { node }), [node]);

    expect(html).toContain("Vector path");
    expect(html).toContain("M 0 0 L 10 0 Z");
  });
});
