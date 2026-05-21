/** @file Viewport pruning tests. */

import { createNodeId, type FrameNode, type GroupNode, type RectNode, type SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { pruneSceneGraphToViewport } from "./viewport-prune";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function rect(id: string, x: number): RectNode {
  return {
    type: "rect",
    id: createNodeId(id),
    transform: { ...IDENTITY, m02: x },
    opacity: 1,
    visible: true,
    effects: [],
    width: 30,
    height: 30,
    fills: [],
  };
}

function maskedGroupOutsideClip(): GroupNode {
  return {
    type: "group",
    id: createNodeId("masked-group"),
    transform: { ...IDENTITY, m02: 130 },
    opacity: 1,
    visible: true,
    effects: [],
    mask: {
      maskId: createNodeId("mask-content"),
      maskType: "ALPHA",
      maskContent: rect("mask-content", 0),
    },
    children: [rect("counter-shifted-child", -130)],
  };
}

function clippedFrame(children: readonly (GroupNode | RectNode)[]): FrameNode {
  return {
    type: "frame",
    id: createNodeId("clip-frame"),
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    width: 100,
    height: 100,
    surfaceShape: { type: "rect", width: 100, height: 100 },
    fills: [],
    clipsContent: true,
    clip: { type: "rect", width: 100, height: 100 },
    children,
  };
}

function graph(children: readonly (GroupNode | RectNode)[]): SceneGraph {
  return {
    width: 100,
    height: 100,
    viewport: { x: 0, y: 0, width: 100, height: 100 },
    root: {
      type: "group",
      id: createNodeId("root"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children: [clippedFrame(children)],
    },
    version: 1,
  };
}

describe("pruneSceneGraphToViewport", () => {
  it("drops children outside an active frame clip even when they intersect the padded viewport", () => {
    const pruned = pruneSceneGraphToViewport(graph([rect("outside-clip", 130)]));
    const frame = pruned.root.children[0] as FrameNode;

    expect(frame.children).toHaveLength(0);
  });

  it("keeps children that intersect an active frame clip", () => {
    const pruned = pruneSceneGraphToViewport(graph([rect("inside-clip", 90)]));
    const frame = pruned.root.children[0] as FrameNode;

    expect(frame.children).toHaveLength(1);
  });

  it("drops masked groups whose mask bounds are outside an active frame clip", () => {
    const pruned = pruneSceneGraphToViewport(graph([maskedGroupOutsideClip()]));
    const frame = pruned.root.children[0] as FrameNode;

    expect(frame.children).toHaveLength(0);
  });
});
