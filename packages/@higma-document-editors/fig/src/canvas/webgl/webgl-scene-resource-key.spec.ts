/** @file WebGL scene resource identity tests. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { getWebGLSceneResourceKey, isWebGLSceneResourceKeyEqual } from "./webgl-scene-resource-key";

function makeRoot(): SceneGraph["root"] {
  return {
    id: "0:1",
    type: "frame",
    name: "root",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    transform: "matrix(1 0 0 1 0 0)",
    opacity: 1,
    visible: true,
    children: [],
  };
}

function makeScene(root: SceneGraph["root"], viewportX: number): SceneGraph {
  return {
    width: 100,
    height: 100,
    root,
    version: 1,
    viewport: {
      x: viewportX,
      y: 0,
      width: 100,
      height: 100,
    },
  };
}

describe("WebGL scene resource identity", () => {
  it("keeps the same resource key when only the viewport changes", () => {
    const root = makeRoot();
    const first = getWebGLSceneResourceKey(makeScene(root, 0));
    const second = getWebGLSceneResourceKey(makeScene(root, 200));

    expect(isWebGLSceneResourceKeyEqual(first, second)).toBe(true);
  });

  it("changes the resource key when the root reference changes", () => {
    const first = getWebGLSceneResourceKey(makeScene(makeRoot(), 0));
    const second = getWebGLSceneResourceKey(makeScene(makeRoot(), 0));

    expect(isWebGLSceneResourceKeyEqual(first, second)).toBe(false);
  });
});
