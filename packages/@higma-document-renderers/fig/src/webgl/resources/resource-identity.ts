/** @file WebGL scene resource identity for viewport-only rerenders. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";

export type WebGLSceneResourceKey = {
  readonly root: SceneGraph["root"];
  readonly rootIdentity: number;
  readonly version: number;
};

export type WebGLSceneResourceIdentityStore = {
  readonly get: (scene: SceneGraph) => WebGLSceneResourceKey;
  readonly isEqual: (left: WebGLSceneResourceKey | null, right: WebGLSceneResourceKey) => boolean;
};

/** Create the SoT for scene resource identity within one WebGL resource context. */
export function createWebGLSceneResourceIdentityStore(): WebGLSceneResourceIdentityStore {
  const rootIdentities = new WeakMap<SceneGraph["root"], number>();
  const nextRootIdentity = { value: 1 };

  function getRootIdentity(root: SceneGraph["root"]): number {
    const existing = rootIdentities.get(root);
    if (existing !== undefined) {
      return existing;
    }
    const id = nextRootIdentity.value;
    nextRootIdentity.value += 1;
    rootIdentities.set(root, id);
    return id;
  }

  return {
    get(scene: SceneGraph): WebGLSceneResourceKey {
      return {
        root: scene.root,
        rootIdentity: getRootIdentity(scene.root),
        version: scene.version,
      };
    },

    isEqual(left: WebGLSceneResourceKey | null, right: WebGLSceneResourceKey): boolean {
      if (!left) {
        return false;
      }
      return left.root === right.root && left.rootIdentity === right.rootIdentity && left.version === right.version;
    },
  };
}
