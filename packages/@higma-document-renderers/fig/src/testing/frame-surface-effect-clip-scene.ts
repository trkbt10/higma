/** @file SceneGraph specimen for FRAME surface effect + child clip ordering. */

import { createNodeId, type SceneGraph } from "../scene-graph";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } as const;






export function createFrameSurfaceEffectClipSceneGraph(): SceneGraph {
  return {
    width: 80,
    height: 60,
    root: {
      type: "group",
      id: createNodeId("root"),
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children: [{
        type: "frame",
        id: createNodeId("surface-effect-frame"),
        transform: IDENTITY,
        opacity: 1,
        visible: true,
        effects: [{
          type: "drop-shadow",
          offset: { x: 0, y: 4 },
          radius: 8,
          color: { r: 0, g: 0, b: 0, a: 0.35 },
          showShadowBehindNode: true,
        }],
        width: 50,
        height: 30,
        surfaceShape: { type: "rect", width: 50, height: 30 },
        fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
        clipsContent: true,
        cornerRadius: 8,
        children: [{
          type: "rect",
          id: createNodeId("overflowing-child"),
          transform: { m00: 1, m01: 0, m02: -10, m10: 0, m11: 1, m12: 2 },
          opacity: 1,
          visible: true,
          effects: [],
          width: 80,
          height: 20,
          fills: [{ type: "solid", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 }],
        }],
      }],
    },
    version: 1,
  };
}
