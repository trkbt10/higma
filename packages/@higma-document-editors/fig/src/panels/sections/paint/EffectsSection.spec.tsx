/** @file Effects section tests. */

import { createElement } from "react";
import { renderSection, sectionInnerShadow, sectionNode } from "../section-specimen";
import { EffectsSection } from "./EffectsSection";

describe("EffectsSection", () => {
  it("renders a Kiwi effect summary", () => {
    const node = sectionNode("FRAME", { effects: [sectionInnerShadow()] });
    const html = renderSection(createElement(EffectsSection, { node }), [node]);

    expect(html).toContain("Effects");
    expect(html).toContain("1 effect(s)");
  });
});
