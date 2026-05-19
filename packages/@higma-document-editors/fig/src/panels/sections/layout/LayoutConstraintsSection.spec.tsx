/** @file Layout constraints section tests. */

import { createElement } from "react";
import { CONSTRAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { renderSection, sectionNode } from "../section-specimen";
import { LayoutConstraintsSection } from "./LayoutConstraintsSection";

describe("LayoutConstraintsSection", () => {
  it("renders Kiwi horizontal and vertical constraints", () => {
    const node = sectionNode("RECTANGLE", {
      horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES.MIN, name: "MIN" },
      verticalConstraint: { value: CONSTRAINT_TYPE_VALUES.SCALE, name: "SCALE" },
    });
    const html = renderSection(createElement(LayoutConstraintsSection, { node }), [node]);

    expect(html).toContain("H: MIN");
    expect(html).toContain("V: SCALE");
  });
});
