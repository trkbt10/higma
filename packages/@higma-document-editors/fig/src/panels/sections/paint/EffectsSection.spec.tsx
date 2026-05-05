/** @file Effect property section tests. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EffectsSection } from "./EffectsSection";
import { createPropertyMutationTarget } from "../../properties/property-mutation-target";
import { createTestDesignNode } from "../../../../spec/unit/shared/test-fixtures";

describe("EffectsSection", () => {
  it("renders add effect controls for nodes without effects", () => {
    const node = createTestDesignNode();
    const html = renderToStaticMarkup(createElement(EffectsSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      dispatch: () => undefined,
    }));

    expect(html).toContain("No effects");
    expect(html).toContain("Add effect");
  });

  it("renders editable controls for shadow effects", () => {
    const node = createTestDesignNode({
      effects: [{
        type: { value: 1, name: "DROP_SHADOW" },
        visible: true,
        offset: { x: 3, y: 4 },
        radius: 8,
        spread: 2,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
      }],
    });
    const html = renderToStaticMarkup(createElement(EffectsSection, {
      node,
      target: createPropertyMutationTarget({ primaryNode: node, selectedNodes: [node] }),
      dispatch: () => undefined,
    }));

    expect(html).toContain('value="DROP_SHADOW"');
    expect(html).toContain('aria-label="Effect type 1"');
    expect(html).toContain('aria-label="Drop Shadow radius"');
    expect(html).toContain('aria-label="Drop Shadow offset x"');
    expect(html).toContain('aria-label="Drop Shadow offset y"');
    expect(html).toContain('aria-label="Drop Shadow spread"');
    expect(html).toContain('aria-label="Drop Shadow opacity"');
    expect(html).toContain('value="8"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="4"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="#000000"');
    expect(html).toContain('value="50"');
  });
});
