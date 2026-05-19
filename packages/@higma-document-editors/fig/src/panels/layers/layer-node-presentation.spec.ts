/** @file Tests for Kiwi layer row presentation. */

import type { FigNode } from "@higma-document-models/fig/types";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { getLayerNodePresentation } from "./layer-node-presentation";

function node(type: "FRAME" | "RECTANGLE", name?: string): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    type: { value: NODE_TYPE_VALUES[type], name: type },
    phase: { value: 0, name: "CREATED" },
    name,
  };
}

describe("getLayerNodePresentation", () => {
  it("uses the Kiwi node name when present", () => {
    expect(getLayerNodePresentation(node("FRAME", "Hero"))).toEqual({
      typeName: "FRAME",
      label: "Hero",
    });
  });

  it("uses the Kiwi node type when name is absent", () => {
    expect(getLayerNodePresentation(node("RECTANGLE"))).toEqual({
      typeName: "RECTANGLE",
      label: "RECTANGLE",
    });
  });
});
