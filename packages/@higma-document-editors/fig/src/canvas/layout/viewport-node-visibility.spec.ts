/** @file Viewport node visibility tests. */
import type { FigNode } from "@higma-document-models/fig/types";
import { filterNodeBoundsForViewport, filterRootNodesForViewport } from "./viewport-node-visibility";
import type { NodeBounds } from "../interaction/bounds";

function node(id: string): FigNode {
  const [sessionID, localID] = id.split(":").map((part) => Number(part));
  if (sessionID === undefined || localID === undefined) {
    throw new Error(`Test node id must be session:local, got ${id}`);
  }
  return {
    guid: { sessionID, localID },
    phase: { value: 0, name: "PAINT" },
    type: { value: 1, name: "FRAME" },
    name: id,
  };
}

function bounds(id: string, rootId: string, x: number, y: number, width: number, height: number): NodeBounds {
  return {
    id,
    rootId,
    x,
    y,
    width,
    height,
    rotation: 0,
    aabb: { x, y, width, height },
  };
}

describe("viewport node visibility", () => {
  it("keeps hit bounds that intersect the viewport and retained selection bounds", () => {
    const result = filterNodeBoundsForViewport({
      bounds: [
        bounds("1:1", "1:1", 0, 0, 100, 100),
        bounds("1:2", "1:1", 500, 0, 100, 100),
        bounds("1:3", "1:1", 700, 0, 100, 100),
      ],
      viewport: { x: 50, y: 0, width: 500, height: 100 },
      retainedIds: ["1:3"],
    });

    expect(result.map((item) => item.id)).toEqual(["1:1", "1:2", "1:3"]);
  });

  it("selects root render nodes by descendant visibility", () => {
    const result = filterRootNodesForViewport({
      nodes: [node("1:1"), node("1:4")],
      bounds: [
        bounds("1:2", "1:1", 200, 0, 50, 50),
        bounds("1:5", "1:4", 900, 0, 50, 50),
      ],
      viewport: { x: 100, y: 0, width: 200, height: 100 },
    });

    expect(result.map((item) => item.guid?.localID)).toEqual([1]);
  });
});
