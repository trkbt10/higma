/** @file Scene resource identity for WebGL viewport-only rerenders. */

import type { SceneGraph } from "@higma/fig-renderer/scene-graph";

export type WebGLSceneResourceKey = {
  readonly root: SceneGraph["root"];
  readonly version: number;
};

/** Return the identity that affects WebGL texture/resource preparation. */
export function getWebGLSceneResourceKey(scene: SceneGraph): WebGLSceneResourceKey {
  return {
    root: scene.root,
    version: scene.version,
  };
}

/** Check whether a scene's GPU resources have already been prepared. */
export function isWebGLSceneResourceKeyEqual(
  left: WebGLSceneResourceKey | null,
  right: WebGLSceneResourceKey,
): boolean {
  if (!left) {
    return false;
  }
  return left.root === right.root && left.version === right.version;
}
