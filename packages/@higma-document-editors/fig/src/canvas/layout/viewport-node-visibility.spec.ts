/** @file Viewport node visibility tests. */
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { filterNodeBoundsForViewport } from "./viewport-node-visibility";

function bounds(id: string, rootId: string, x: number, y: number, width: number, height: number): SceneGraphNodeBounds {
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
  it("keeps viewport-intersecting hit bounds and selected Kiwi node bounds", () => {
    const result = filterNodeBoundsForViewport({
      bounds: [
        bounds("1:1", "1:1", 0, 0, 100, 100),
        bounds("1:2", "1:1", 500, 0, 100, 100),
        bounds("1:3", "1:1", 700, 0, 100, 100),
      ],
      viewport: { x: 50, y: 0, width: 500, height: 100 },
      selectedNodeGuidKeys: ["1:3"],
    });

    expect(result.map((item) => item.id)).toEqual(["1:1", "1:2", "1:3"]);
  });
});
