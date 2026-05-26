/** @file WebGL scene resource reference key for viewport-only rerenders. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";

export type WebGLSceneResourceReferenceKey = {
  readonly sourceDocumentReference: object;
  readonly sceneRoot: SceneGraph["root"];
};

/** Create the WebGL resource reference key from the SceneGraph references themselves. */
export function createWebGLSceneResourceReferenceKey(scene: SceneGraph): WebGLSceneResourceReferenceKey {
  return {
    sourceDocumentReference: scene.sourceDocumentReference,
    sceneRoot: scene.root,
  };
}

/** Compare two WebGL resource reference keys by the SceneGraph references that own renderer resources. */
export function areWebGLSceneResourceReferenceKeysEqual(
  left: WebGLSceneResourceReferenceKey | null,
  right: WebGLSceneResourceReferenceKey,
): boolean {
  if (left === null) {
    return false;
  }
  return left.sourceDocumentReference === right.sourceDocumentReference &&
    left.sceneRoot === right.sceneRoot;
}
