/** @file Auto layout section tests. */

import { createElement } from "react";
import { STACK_JUSTIFY_VALUES, STACK_MODE_VALUES } from "@higma-document-models/fig/constants";
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
    expect(html).toContain("aria-label=\"Auto layout gap\"");
    expect(html).toContain("value=\"12\"");
  });

  it("renders Kiwi justify values for wrapped content alignment", () => {
    const node = sectionNode("FRAME", {
      stackMode: { value: STACK_MODE_VALUES.VERTICAL, name: "VERTICAL" },
      stackPrimaryAlignContent: {
        value: STACK_JUSTIFY_VALUES.SPACE_BETWEEN,
        name: "SPACE_BETWEEN",
      },
    });
    const html = renderSection(createElement(AutoLayoutSection, { node }), [node]);

    expect(html).toContain("aria-label=\"Auto layout align content\"");
    expect(html).toContain("value=\"SPACE_BETWEEN\" selected");
  });

  it("renders mode control for containers without an existing stack mode", () => {
    const node = sectionNode("FRAME");
    const html = renderSection(createElement(AutoLayoutSection, { node }), [node]);

    expect(html).toContain("aria-label=\"Auto layout mode\"");
    expect(html).toContain("value=\"NONE\" selected");
  });
});
