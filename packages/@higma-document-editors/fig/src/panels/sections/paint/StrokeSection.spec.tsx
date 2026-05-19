/** @file Stroke section tests. */

import { createElement } from "react";
import { renderSection, SECTION_COLORS, sectionNode, sectionPaints } from "../section-specimen";
import { StrokeSection } from "./StrokeSection";

describe("StrokeSection", () => {
  it("renders Kiwi solid stroke and scalar strokeWeight", () => {
    const node = sectionNode("RECTANGLE", {
      strokePaints: sectionPaints(SECTION_COLORS.dark),
      strokeWeight: 4,
    });
    const html = renderSection(createElement(StrokeSection, { node }), [node]);

    expect(html).toContain("Stroke");
    expect(html).toContain("value=\"#1a1a1a\"");
    expect(html).toContain("value=\"4\"");
  });
});
