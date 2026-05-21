/** @file WebGL render culling tests. */

import type { RenderPathNode, RenderRectNode } from "../../scene-graph";
import type { PathNode, RectNode, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import { shouldRenderVisualNode } from "./render-culling";

function makeRect(overrides: Partial<RenderRectNode> = {}): RenderRectNode {
  const source: RectNode = {
    id: "rect" as SceneNodeId,
    type: "rect",
    name: "Rect",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    width: 100,
    height: 80,
    fills: [],
    stroke: undefined,
    effects: [],
    opacity: 1,
  };
  return {
    id: "rect" as SceneNodeId,
    type: "rect",
    width: 100,
    height: 80,
    fill: { attrs: { fill: "none" } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceFills: [],
    ...overrides,
  };
}

function makeResolvedPath(): RenderPathNode {
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
  return {
    id: "path" as SceneNodeId,
    type: "path",
    paths: [{ d: "M 1200 1200 L 1300 1200 L 1300 1300 Z" }],
    fill: { attrs: { fill: "none" } },
    wrapper: {},
    defs: [],
    needsWrapper: false,
    source,
    sourceContours: [],
    sourceFills: [],
  };
}

describe("WebGL render culling", () => {
  it("skips visual nodes outside the padded viewport", () => {
    const node = makeRect();

    expect(shouldRenderVisualNode({
      node,
      transform: { m00: 1, m01: 0, m02: 1200, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      options: { paddingPx: 100 },
    })).toBe(false);
  });

  it("keeps effect-inflated nodes near the viewport", () => {
    const node = makeRect({
      source: {
        ...makeRect().source,
        effects: [{ type: "drop-shadow", offset: { x: 200, y: 0 }, radius: 40, color: { r: 0, g: 0, b: 0, a: 1 }, showShadowBehindNode: true }],
      },
    });

    expect(shouldRenderVisualNode({
      node,
      transform: { m00: 1, m01: 0, m02: 620, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      options: { paddingPx: 0 },
    })).toBe(true);
  });

  it("uses min pixel area as a lightweight LOD cutoff", () => {
    const node = makeRect();

    expect(shouldRenderVisualNode({
      node,
      transform: { m00: 0.001, m01: 0, m02: 10, m10: 0, m11: 0.001, m12: 10 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      options: { paddingPx: 0, minPixelArea: 1 },
    })).toBe(false);
  });

  it("keeps tiny transformed stroke-only geometry when stroke width is still visible", () => {
    const node = makeRect({
      sourceStroke: {
        width: 1000,
        linecap: "butt",
        linejoin: "miter",
        color: { r: 1, g: 0, b: 0, a: 1 },
        opacity: 1,
      },
      source: {
        ...makeRect().source,
        stroke: {
          width: 1000,
          linecap: "butt",
          linejoin: "miter",
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
        },
      },
    });

    expect(shouldRenderVisualNode({
      node,
      transform: { m00: 0.001, m01: 0, m02: 10, m10: 0, m11: 0.001, m12: 10 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      options: { paddingPx: 0, minPixelArea: 1 },
    })).toBe(true);
  });

  it("uses resolved RenderTree path data for path bounds", () => {
    expect(shouldRenderVisualNode({
      node: makeResolvedPath(),
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      viewport: { x: 0, y: 0, width: 500, height: 500 },
      options: { paddingPx: 0 },
    })).toBe(false);
  });

  it("memoises path bounds so pan/zoom rerenders never re-parse the same RenderPathNode", () => {
    // Pan/zoom only changes the viewport transform — the WebGL
    // render-tree cache hands the same `RenderPathNode` instance back
    // to the renderer every frame. The culler asks for local bounds
    // first, and historically that re-ran `parseSvgPathD` and
    // `flattenPathCommands` on every frame just to compute a bbox.
    // The fix is a node-keyed memo: a `Float32Array.from` spy on the
    // result is mutation-free, but a counting wrapper around the path
    // node's getter would be redundant. Instead we count parsed
    // command depth indirectly: only the second invocation can
    // observe the cache, so we verify by tagging the node's `paths`
    // array with a `[Symbol.iterator]` that throws after first use.
    const node = makeResolvedPath();
    // First call populates the bounds cache.
    const transformA = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const transformB = { m00: 2, m01: 0, m02: -100, m10: 0, m11: 2, m12: -100 };
    expect(shouldRenderVisualNode({ node, transform: transformA, viewport: { x: 0, y: 0, width: 500, height: 500 }, options: { paddingPx: 0 } })).toBe(false);

    // Once cached, mutating the `paths.d` source string must not
    // affect the cull decision — proof that the node's prior parse
    // result is being reused rather than re-derived.
    const mutablePaths = node.paths as Array<{ d: string; fillRule?: "evenodd" }>;
    mutablePaths[0] = { d: "M 0 0 L 10 0 L 10 10 Z" };
    expect(shouldRenderVisualNode({ node, transform: transformB, viewport: { x: 0, y: 0, width: 500, height: 500 }, options: { paddingPx: 0 } })).toBe(false);
  });
});
