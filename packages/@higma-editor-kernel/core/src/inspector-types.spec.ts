/** @file Inspector type helper contract tests. */

import {
  resolveNodeColor,
  resolveNodeLabel,
  type NodeCategoryRegistry,
} from "./inspector-types";

const REGISTRY: NodeCategoryRegistry = {
  categories: {
    shape: { color: "#f97316", label: "Shape" },
  },
  getCategory(nodeType) {
    if (nodeType === "RECTANGLE") {
      return "shape";
    }
    return "missing";
  },
};

describe("inspector category resolution", () => {
  it("resolves color and label through an explicitly registered category", () => {
    expect(resolveNodeColor(REGISTRY, "RECTANGLE")).toBe("#f97316");
    expect(resolveNodeLabel(REGISTRY, "RECTANGLE")).toBe("Shape");
  });

  it("throws when the registry returns an unregistered category", () => {
    expect(() => resolveNodeColor(REGISTRY, "UNSUPPORTED")).toThrow("missing category");
    expect(() => resolveNodeLabel(REGISTRY, "UNSUPPORTED")).toThrow("missing category");
  });
});
