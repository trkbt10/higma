/** @file Auto layout section tests. */

import { createElement } from "react";
import { STACK_MODE_VALUES } from "@higma-document-models/fig/constants";
import { renderSection, sectionNode } from "../section-specimen";
import { AutoLayoutSection } from "./AutoLayoutSection";

describe("AutoLayoutSection", () => {
  it("renders stack spacing from Kiwi stack fields", () => {
    const node = sectionNode("FRAME", {
      stackMode: { value: STACK_MODE_VALUES.VERTICAL, name: "VERTICAL" },
      stackSpacing: 12,
    });
    const html = renderSection(createElement(AutoLayoutSection, { node }), [node]);

    expect(html).toContain("Auto layout");
    expect(html).toContain("value=\"12\"");
  });
});
