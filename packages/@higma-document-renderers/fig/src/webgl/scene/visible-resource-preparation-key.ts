/** @file WebGL visible resource preparation reference key. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import { createWebGLSceneResourceReferenceKey, type WebGLSceneResourceReferenceKey } from "../resources/scene-resource-reference-key";

type SceneGraphViewport = NonNullable<SceneGraph["viewport"]>;

export type WebGLVisibleResourcePreparationKey = {
  readonly sourceDocumentReference: WebGLSceneResourceReferenceKey["sourceDocumentReference"];
  readonly sceneRoot: WebGLSceneResourceReferenceKey["sceneRoot"];
  readonly visibleTextureResourceIds: readonly string[];
};

export type WebGLVisibleResourcePreparationKeyInput = {
  readonly scene: SceneGraph;
  readonly visibleTextureResourceIds: readonly string[];
};

function requireSceneGraphViewport(scene: SceneGraph): SceneGraphViewport {
  if (scene.viewport === undefined) {
    throw new Error("WebGL visible resource preparation requires scene.viewport");
  }
  return scene.viewport;
}

function normalizedVisibleTextureResourceIds(ids: readonly string[]): readonly string[] {
  const sorted = [...ids].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new Error(`WebGL visible resource preparation key received duplicate texture resource ${sorted[index]}`);
    }
  }
  return sorted;
}

/** Create the preparation reference key for one Kiwi-derived scene resource and its visible texture set. */
export function createWebGLVisibleResourcePreparationKey(
  { scene, visibleTextureResourceIds }: WebGLVisibleResourcePreparationKeyInput,
): WebGLVisibleResourcePreparationKey {
  requireSceneGraphViewport(scene);
  const sceneResource = createWebGLSceneResourceReferenceKey(scene);
  return {
    sourceDocumentReference: sceneResource.sourceDocumentReference,
    sceneRoot: sceneResource.sceneRoot,
    visibleTextureResourceIds: normalizedVisibleTextureResourceIds(visibleTextureResourceIds),
  };
}

function areVisibleTextureResourceIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, index) => id === right[index]);
}

/** Compare prepared-resource reference keys by Kiwi-derived source document and visible texture set. */
export function areWebGLVisibleResourcePreparationKeysEqual(
  left: WebGLVisibleResourcePreparationKey | null,
  right: WebGLVisibleResourcePreparationKey,
): boolean {
  if (left === null) {
    return false;
  }
  return left.sourceDocumentReference === right.sourceDocumentReference &&
    left.sceneRoot === right.sceneRoot &&
    areVisibleTextureResourceIdsEqual(left.visibleTextureResourceIds, right.visibleTextureResourceIds);
}
