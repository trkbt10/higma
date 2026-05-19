/** @file Instance resolution section tests. */

import { createElement } from "react";
import { renderSection, sectionGuid, sectionNode, sectionSymbolPair } from "../section-specimen";
import { InstanceOverridesSection } from "./InstanceOverridesSection";

describe("InstanceOverridesSection", () => {
  it("renders SymbolResolver output for an INSTANCE", () => {
    const { symbol, instance } = sectionSymbolPair();
    const child = sectionNode("TEXT", {
      guid: sectionGuid(12),
      parentIndex: { guid: symbol.guid, position: "a" },
      name: "Button Label",
      opacity: 0.75,
    });
    const html = renderSection(createElement(InstanceOverridesSection, { node: instance }), [symbol, child, instance]);

    expect(html).toContain("Instance");
    expect(html).toContain("Instance override opacity");
    expect(html).toContain("Override Button Label opacity");
    expect(html).toContain("75");
  });
});
