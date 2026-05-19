/** @file Component set variants section tests. */

import { createElement } from "react";
import { renderSection, sectionGuid, sectionNode } from "../section-specimen";
import { ComponentSetVariantsSection } from "./ComponentSetVariantsSection";

describe("ComponentSetVariantsSection", () => {
  it("renders variant definitions from Kiwi componentPropDefs", () => {
    const node = sectionNode("FRAME", {
      isStateGroup: true,
      componentPropDefs: [{ id: sectionGuid(20), name: "State", type: { value: 4, name: "VARIANT" } }],
    });
    const child = sectionNode("SYMBOL", {
      guid: sectionGuid(21),
      parentIndex: { guid: node.guid, position: "a" },
      name: "Primary",
      variantPropSpecs: [{ propDefId: sectionGuid(20), value: "Default" }],
    });
    const html = renderSection(createElement(ComponentSetVariantsSection, { node }), [node, child]);

    expect(html).toContain("Component set");
    expect(html).toContain("State");
    expect(html).toContain("Primary State");
    expect(html).toContain("Default");
  });
});
