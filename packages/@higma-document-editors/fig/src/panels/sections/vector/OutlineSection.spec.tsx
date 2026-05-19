/** @file Outline section tests. */

import { createElement } from "react";
import { renderSection, sectionNode } from "../section-specimen";
import { OutlineSection } from "./OutlineSection";

describe("OutlineSection", () => {
  it("renders outline controls for supported Kiwi nodes", () => {
    const node = sectionNode("ROUNDED_RECTANGLE");

    expect(renderSection(createElement(OutlineSection, { node }), [node])).toContain("Outline selection");
  });

  it("does not render controls for unsupported Kiwi nodes", () => {
    const node = sectionNode("CANVAS");

    expect(renderSection(createElement(OutlineSection, { node }), [node])).toBe("");
  });
});
