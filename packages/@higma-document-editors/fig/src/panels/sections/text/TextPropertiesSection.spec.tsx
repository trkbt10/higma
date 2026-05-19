/** @file Text properties section tests. */

import { createElement } from "react";
import { renderSection, sectionNode, sectionTextData } from "../section-specimen";
import { TextPropertiesSection } from "./TextPropertiesSection";

describe("TextPropertiesSection", () => {
  it("renders explicit Kiwi textData without defaulting missing font fields", () => {
    const textData = sectionTextData("Hello");
    const node = sectionNode("TEXT", {
      textData,
      fontSize: textData.fontSize,
      fontName: textData.fontName,
    });
    const html = renderSection(createElement(TextPropertiesSection, { node }), [node]);

    expect(html).toContain("Hello");
    expect(html).toContain("value=\"16\"");
    expect(html).toContain("value=\"Inter\"");
  });

  it("throws when a TEXT node lacks textData", () => {
    const node = sectionNode("TEXT");

    expect(() => renderSection(createElement(TextPropertiesSection, { node }), [node])).toThrow(
      "TextPropertiesSection requires Kiwi textData on TEXT nodes",
    );
  });
});
