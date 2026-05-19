/** @file Property-panel mutation target tests. */

import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigNode } from "@higma-document-models/fig/types";
import { requirePropertyMutationTarget } from "./property-mutation-target";

const node: FigNode = {
  guid: { sessionID: 72, localID: 1 },
  phase: { value: 0, name: "PAINT" },
  type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
  name: "Selected",
  visible: true,
  opacity: 1,
  transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
  size: { x: 10, y: 10 },
};

describe("requirePropertyMutationTarget", () => {
  it("returns the selected Kiwi node as the mutation target", () => {
    expect(requirePropertyMutationTarget(node)).toEqual({ node });
  });

  it("throws before mutating when no selected node exists", () => {
    expect(() => requirePropertyMutationTarget(undefined)).toThrow(
      "PropertyPanel requires a selected Kiwi node before mutating properties",
    );
  });
});
