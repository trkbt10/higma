/** @file WebGL scene resource identity tests. */

import type { SceneGraph } from "../scene-graph/types";
import type { GroupNode, SceneNodeId } from "../scene-graph/types";
import { createWebGLSceneResourceIdentityStore } from "./resource-identity";

function makeRoot(id: string): GroupNode {
  return {
    id: id as SceneNodeId,
    type: "group",
    name: id,
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    children: [],
  };
}

function makeScene(root: GroupNode, version: number, viewportX: number): SceneGraph {
  return {
    root,
    width: 200,
    height: 100,
    version,
    viewport: { x: viewportX, y: 0, width: 200, height: 100 },
  };
}

describe("WebGL scene resource identity", () => {
  it("keeps the same resource key when only the viewport changes", () => {
    const store = createWebGLSceneResourceIdentityStore();
    const root = makeRoot("root");
    const first = store.get(makeScene(root, 7, 0));
    const second = store.get(makeScene(root, 7, 120));

    expect(store.isEqual(first, second)).toBe(true);
  });

  it("changes the resource key when the root reference changes", () => {
    const store = createWebGLSceneResourceIdentityStore();
    const first = store.get(makeScene(makeRoot("first"), 7, 0));
    const second = store.get(makeScene(makeRoot("second"), 7, 0));

    expect(store.isEqual(first, second)).toBe(false);
  });

  it("assigns stable incremental identities per root reference", () => {
    const store = createWebGLSceneResourceIdentityStore();
    const firstRoot = makeRoot("first");
    const secondRoot = makeRoot("second");

    expect(store.get(makeScene(firstRoot, 1, 0)).rootIdentity).toBe(1);
    expect(store.get(makeScene(firstRoot, 2, 0)).rootIdentity).toBe(1);
    expect(store.get(makeScene(secondRoot, 1, 0)).rootIdentity).toBe(2);
  });
});
