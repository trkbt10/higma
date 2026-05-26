/** @file Component properties section tests. */

import { createElement } from "react";
import { renderSection, sectionGuid, sectionNode } from "../section-specimen";
import { ComponentPropertiesSection } from "./ComponentPropertiesSection";

describe("ComponentPropertiesSection", () => {
  it("renders resolved component properties for INSTANCE nodes", () => {
    const symbol = sectionNode("SYMBOL", {
      guid: sectionGuid(10),
      name: "Symbol root",
      componentPropDefs: [{
        id: sectionGuid(20),
        name: "Label",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "Default label" } },
      }],
    });
    const instance = sectionNode("INSTANCE", {
      guid: sectionGuid(11),
      symbolData: { symbolID: symbol.guid },
    });
    const rect = sectionNode("RECTANGLE", { guid: { sessionID: 80, localID: 3 } });

    const html = renderSection(createElement(ComponentPropertiesSection, { node: instance }), [symbol, instance]);

    expect(html).toContain("Component");
    expect(html).toContain("Component: Symbol root");
    expect(html).toContain("Label");
    expect(html).toContain("Default label");
    expect(renderSection(createElement(ComponentPropertiesSection, { node: rect }), [rect])).not.toContain("Component");
  });

  it("renders properties inherited through Kiwi parentPropDefId", () => {
    const frame = sectionNode("FRAME", {
      guid: sectionGuid(9),
      name: "Variant frame",
      componentPropDefs: [{
        id: sectionGuid(20),
        name: "Time",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "9:41" } },
      }],
    });
    const symbol = sectionNode("SYMBOL", {
      guid: sectionGuid(10),
      name: "Status bar",
      parentIndex: { guid: frame.guid, position: "!" },
      componentPropDefs: [{
        id: sectionGuid(21),
        parentPropDefId: sectionGuid(20),
      }],
    });
    const instance = sectionNode("INSTANCE", {
      guid: sectionGuid(11),
      symbolData: { symbolID: symbol.guid },
    });

    const html = renderSection(createElement(ComponentPropertiesSection, { node: instance }), [frame, symbol, instance]);

    expect(html).toContain("Time");
    expect(html).toContain("9:41");
  });

  it("does not render properties when the document SymbolResolver cannot resolve the INSTANCE symbol", () => {
    const instance = sectionNode("INSTANCE", {
      guid: sectionGuid(11),
      symbolData: { symbolID: sectionGuid(99) },
    });

    expect(renderSection(createElement(ComponentPropertiesSection, { node: instance }), [instance])).not.toContain("Component");
  });
});
