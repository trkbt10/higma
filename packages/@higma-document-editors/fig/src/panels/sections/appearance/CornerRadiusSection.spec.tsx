/** @file Corner radius section tests. */

import { createElement } from "react";
import { sectionNode, renderSection } from "../section-specimen";
import { CornerRadiusSection } from "./CornerRadiusSection";

describe("CornerRadiusSection", () => {
  it("renders a Kiwi cornerRadius field", () => {
    const node = sectionNode("RECTANGLE", { cornerRadius: 8 });
    const html = renderSection(createElement(CornerRadiusSection, { node }), [node]);

    expect(html).toContain("Corners");
    expect(html).toContain("Radius");
    expect(html).toContain("value=\"8\"");
  });
});
