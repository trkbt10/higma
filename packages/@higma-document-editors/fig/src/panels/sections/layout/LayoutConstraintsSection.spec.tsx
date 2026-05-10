/** @file Layout constraints property section tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import { CONSTRAINT_TYPE_VALUES, STACK_POSITIONING_VALUES, STACK_SIZING_VALUES, toEnumValue } from "@higma-document-models/fig/constants";
import { LayoutConstraintsSection } from "./LayoutConstraintsSection";
import { createPropertyMutationTarget } from "../../properties/property-mutation-target";

function makeNode(layoutConstraints?: FigDesignNode["layoutConstraints"]): FigDesignNode {
  return {
    id: "rect" as FigNodeId,
    type: "RECTANGLE",
    name: "Rect",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 120, y: 80 },
    fills: [],
    strokes: [],
    strokeWeight: 0,
    effects: [],
    layoutConstraints,
  };
}

describe("LayoutConstraintsSection", () => {
  it("renders explicit default child layout controls", () => {
    const node = makeNode();
    const html = renderToStaticMarkup(createElement(LayoutConstraintsSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      dispatch: () => undefined,
    }));

    expect(html).toContain("Position");
    expect(html).toContain('value="AUTO"');
    expect(html).toContain("Primary fit");
    expect(html).toContain("Counter fit");
  });

  it("renders fixed positioning constraints when absolute", () => {
    const node = makeNode({
      stackPositioning: toEnumValue("ABSOLUTE", STACK_POSITIONING_VALUES)!,
      stackPrimarySizing: toEnumValue("RESIZE_TO_FIT", STACK_SIZING_VALUES)!,
      stackCounterSizing: toEnumValue("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE", STACK_SIZING_VALUES)!,
      stackChildPrimaryGrow: 1,
      horizontalConstraint: toEnumValue("CENTER", CONSTRAINT_TYPE_VALUES)!,
      verticalConstraint: toEnumValue("STRETCH", CONSTRAINT_TYPE_VALUES)!,
    });
    const html = renderToStaticMarkup(createElement(LayoutConstraintsSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      dispatch: () => undefined,
    }));

    expect(html).toContain('value="ABSOLUTE"');
    expect(html).toContain('value="RESIZE_TO_FIT"');
    expect(html).toContain('value="RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"');
    expect(html).toContain('value="1"');
    expect(html).toContain("Horizontal");
    expect(html).toContain("Vertical");
  });
});
