/** @file Fill section tests. */

import { createElement } from "react";
import { renderSection, SECTION_COLORS, sectionNode, sectionPaints } from "../section-specimen";
import { FillSection } from "./FillSection";

describe("FillSection", () => {
  it("renders the first Kiwi solid fill as a color input", () => {
    const node = sectionNode("RECTANGLE", { fillPaints: sectionPaints(SECTION_COLORS.blue) });
    const html = renderSection(createElement(FillSection, { node }), [node]);

    expect(html).toContain("Fill");
    expect(html).toContain("type=\"color\"");
    expect(html).toContain("value=\"#3380e6\"");
  });
});
