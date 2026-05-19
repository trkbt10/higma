/** @file Incremental RenderTree resolution tests. */

import { createNodeId } from "@higma-document-renderers/fig/scene-graph";
import type { FrameNode, RectNode, SceneGraph, SceneNode } from "@higma-document-renderers/fig/scene-graph";
import { resolveRenderTreeIncremental } from "./resolve";

const identity = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const redFill = { type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 } as const;

function rect(id: string, x: number): RectNode {
  return {
    id: createNodeId(id),
    type: "rect",
    transform: { ...identity, m02: x },
    opacity: 1,
    visible: true,
    effects: [],
    width: 10,
    height: 10,
    fills: [redFill],
  };
}

function graphWithChildren(children: readonly SceneNode[]): SceneGraph {
  return {
    width: 100,
    height: 100,
    version: 1,
    root: {
      id: createNodeId("root"),
      type: "group",
      transform: identity,
      opacity: 1,
      visible: true,
      effects: [],
      children,
    },
  };
}

function graph(first: RectNode, second: RectNode): SceneGraph {
  return graphWithChildren([first, second]);
}

function viewportFrame(child: SceneNode): FrameNode {
  return {
    id: createNodeId("viewport-frame"),
    type: "frame",
    transform: identity,
    opacity: 1,
    visible: true,
    effects: [],
    width: 100,
    height: 100,
    fills: [],
    clipsContent: true,
    children: [child],
  };
}

describe("resolveRenderTreeIncremental", () => {
  it("reuses unchanged sibling RenderNodes across partial scene updates", () => {
    const first = rect("first", 0);
    const second = rect("second", 20);
    const initial = resolveRenderTreeIncremental(graph(first, second), undefined);

    const movedFirst = rect("first", 5);
    const next = resolveRenderTreeIncremental(graph(movedFirst, second), initial.cache);

    expect(next.renderTree.children[0]).not.toBe(initial.renderTree.children[0]);
    expect(next.renderTree.children[1]).toBe(initial.renderTree.children[1]);
  });

  it("reuses the root children array when no rendered child changed", () => {
    const first = rect("first", 0);
    const second = rect("second", 20);
    const initial = resolveRenderTreeIncremental(graph(first, second), undefined);
    const next = resolveRenderTreeIncremental(graph(first, second), initial.cache);

    expect(next.renderTree.children).toBe(initial.renderTree.children);
  });

  it("reuses root children after viewport clip omission is applied", () => {
    const frame = viewportFrame(rect("inner", 0));
    const initial = resolveRenderTreeIncremental(graphWithChildren([frame]), undefined);
    const next = resolveRenderTreeIncremental(graphWithChildren([frame]), initial.cache);

    expect(next.renderTree.children).toBe(initial.renderTree.children);
  });

  it("invalidates reused nodes when export settings change", () => {
    const first = rect("first", 0);
    const initial = resolveRenderTreeIncremental(graphWithChildren([first]), undefined);
    const next = resolveRenderTreeIncremental(graphWithChildren([first]), initial.cache, {
      exportSettings: { colorProfile: "SRGB" },
    });

    expect(next.renderTree.children[0]).not.toBe(initial.renderTree.children[0]);
  });
});
