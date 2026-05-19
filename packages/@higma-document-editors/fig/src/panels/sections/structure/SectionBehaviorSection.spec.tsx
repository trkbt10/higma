/** @file Section behavior section tests. */

import { createElement } from "react";
import { renderSection, sectionNode } from "../section-specimen";
import { SectionBehaviorSection } from "./SectionBehaviorSection";

describe("SectionBehaviorSection", () => {
  it("renders SECTION visibility behavior from Kiwi fields", () => {
    const node = sectionNode("SECTION", { sectionContentsHidden: true });
    const html = renderSection(createElement(SectionBehaviorSection, { node }), [node]);

    expect(html).toContain("Section");
    expect(html).toContain("role=\"switch\"");
    expect(html).toContain("aria-checked=\"true\"");
  });
});
