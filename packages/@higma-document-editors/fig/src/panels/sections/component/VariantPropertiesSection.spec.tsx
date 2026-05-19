/** @file Variant properties section tests. */

import { createElement } from "react";
import { renderSection, sectionGuid, sectionNode } from "../section-specimen";
import { VariantPropertiesSection } from "./VariantPropertiesSection";

describe("VariantPropertiesSection", () => {
  it("renders variant labels from Kiwi data", () => {
    const node = sectionNode("SYMBOL", {
      variantPropSpecs: [{ propDefId: sectionGuid(21), value: "Primary" }],
    });
    const html = renderSection(createElement(VariantPropertiesSection, { node }), [node]);

    expect(html).toContain("Variant 1");
    expect(html).toContain("Primary");
  });
});
