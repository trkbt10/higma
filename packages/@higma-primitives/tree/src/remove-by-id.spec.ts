/**
 * @file Regression tests for structural tree deletion by identifier.
 */

import { removeById } from "./remove-by-id";

type Node = { id: string; children?: readonly Node[] };

describe("removeById", () => {
  it("removes a matching subtree by id while preserving unchanged branches", () => {
    const keep: Node = { id: "keep" };
    const nodes: Node[] = [
      { id: "root", children: [{ id: "remove", children: [{ id: "nested" }] }, keep] },
    ];
    const result = removeById(nodes, "remove", {
      getId: (node) => node.id,
      getChildren: (node) => node.children,
      withChildren: (node, children) => ({ ...node, children }),
    });
    expect(result.removed).toBe(true);
    expect(result.nodes).toEqual([{ id: "root", children: [keep] }]);
    expect(result.nodes[0]?.children?.[0]).toBe(keep);
  });

  it("returns the original root array when no node is removed", () => {
    const nodes: Node[] = [{ id: "root", children: [{ id: "child" }] }];
    const result = removeById(nodes, "missing", {
      getId: (node) => node.id,
      getChildren: (node) => node.children,
      withChildren: (node, children) => ({ ...node, children }),
    });
    expect(result.removed).toBe(false);
    expect(result.nodes).toBe(nodes);
  });
});
