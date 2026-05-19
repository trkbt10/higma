/** @file WebGL geometry cache memoisation tests. */

import type { Fill, PathNode, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import type { RenderPathNode } from "../../scene-graph";
import { createWebGLGeometryCache } from "./geometry-cache";

function makeRenderPathNode(): RenderPathNode {
  const source: PathNode = {
    id: "path" as SceneNodeId,
    type: "path",
    name: "Path",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    contours: [],
    fills: [],
    effects: [],
    opacity: 1,
  };
  const solidFill: Fill = {
    type: "solid",
    color: { r: 1, g: 0, b: 0, a: 1 },
    opacity: 1,
  };
  return {
    id: "path" as SceneNodeId,
    type: "path",
    paths: [{ d: "M 0 0 L 100 0 L 100 100 L 0 100 Z" }],
    fill: { attrs: { fill: "#ff0000", fillOpacity: 1 } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceContours: [],
    sourceFills: [solidFill],
  };
}

describe("createWebGLGeometryCache — viewport-only rerender memoisation", () => {
  it("returns identical PathGeometry references for repeated lookups (so pan/zoom never re-flattens)", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const first = cache.getPathGeometry(node);
    const second = cache.getPathGeometry(node);
    expect(second).toBe(first);
    expect(second.parsedContours).toBe(first.parsedContours);
    expect(second.elementSize).toBe(first.elementSize);
  });

  it("returns identical fill-plan instructions across rerenders, including prepared fan vertices and cover quads", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const first = cache.getPathFillPlanGeometry(node);
    const second = cache.getPathFillPlanGeometry(node);
    expect(second).toBe(first);
    expect(second.instructions).toBe(first.instructions);
    expect(second.instructions[0]?.prepared).toBe(first.instructions[0]?.prepared);
    expect(second.instructions[0]?.coverQuad).toBe(first.instructions[0]?.coverQuad);
  });

  it("exposes a control-hull element size that matches the path's outer extent", () => {
    const cache = createWebGLGeometryCache();
    const node = makeRenderPathNode();
    const { elementSize } = cache.getPathGeometry(node);
    expect(elementSize).toEqual({ width: 100, height: 100 });
  });

  it("keys rect vertices by corner smoothing as part of the geometry identity", () => {
    const cache = createWebGLGeometryCache();
    const radii = [24, 4, 16, 8] as const;
    const standard = cache.getRectVertices(100, 80, radii);
    const smoothed = cache.getRectVertices(100, 80, radii, 0.6);
    const smoothedAgain = cache.getRectVertices(100, 80, radii, 0.6);

    expect(smoothed).toBe(smoothedAgain);
    expect(smoothed).not.toBe(standard);
    expect(smoothed.length).toBeGreaterThan(0);
  });
});
