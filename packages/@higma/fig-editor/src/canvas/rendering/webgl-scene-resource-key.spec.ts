/** @file WebGL scene resource identity tests. */

import type { SceneGraph } from "@higma/fig-renderer/scene-graph";
import { getWebGLSceneResourceKey, isWebGLSceneResourceKeyEqual } from "./webgl-scene-resource-key";

function makeScene(root: SceneGraph["root"], viewportX: number): SceneGraph {
  return {
    width: 500,
    height: 400,
    viewport: {
      x: viewportX,
      y: 0,
      width: 500,
      height: 400,
    },
    root,
    version: 1,
  };
}

function makeRoot(): SceneGraph["root"] {
  return {
    id: "root",
    type: "GROUP",
    name: "root",
    visible: true,
    opacity: 1,
    transform: [1, 0, 0, 1, 0, 0],
    children: [],
  };
}

describe("WebGL scene resource identity", () => {
  it("treats viewport-only scene changes as already prepared", () => {
    const root = makeRoot();
    const first = getWebGLSceneResourceKey(makeScene(root, 0));
    const second = getWebGLSceneResourceKey(makeScene(root, 200));

    expect(isWebGLSceneResourceKeyEqual(first, second)).toBe(true);
  });

  it("requires preparation when scene content identity changes", () => {
    const first = getWebGLSceneResourceKey(makeScene(makeRoot(), 0));
    const second = getWebGLSceneResourceKey(makeScene(makeRoot(), 0));

    expect(isWebGLSceneResourceKeyEqual(first, second)).toBe(false);
  });
});
