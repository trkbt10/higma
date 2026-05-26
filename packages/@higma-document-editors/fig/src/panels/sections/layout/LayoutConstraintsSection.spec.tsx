/** @file Layout constraints section tests. */

import { createElement } from "react";
import { CONSTRAINT_TYPE_VALUES, STACK_POSITIONING_VALUES } from "@higma-document-models/fig/constants";
import { renderSection, sectionGuid, sectionNode } from "../section-specimen";
import { LayoutConstraintsSection } from "./LayoutConstraintsSection";

describe("LayoutConstraintsSection", () => {
  it("renders Kiwi horizontal and vertical constraints", () => {
    const node = sectionNode("RECTANGLE", {
      parentIndex: { guid: sectionGuid(1), position: "a" },
      stackPositioning: { value: STACK_POSITIONING_VALUES.ABSOLUTE, name: "ABSOLUTE" },
      horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES.MIN, name: "MIN" },
      verticalConstraint: { value: CONSTRAINT_TYPE_VALUES.SCALE, name: "SCALE" },
    });
    const html = renderSection(createElement(LayoutConstraintsSection, { node }), [node]);

    expect(html).toContain("aria-label=\"Layout horizontal constraint\"");
    expect(html).toContain("value=\"MIN\" selected");
    expect(html).toContain("aria-label=\"Layout vertical constraint\"");
    expect(html).toContain("value=\"SCALE\" selected");
  });
});
