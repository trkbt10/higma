/** @file RenderTree cache for WebGL viewport-only rerenders. */

import type { SceneGraph } from "@higma-document-models/fig/scene-graph";
import { resolveRenderTree, type RenderTree } from "../../scene-graph/render-tree";
import type {
  FigmaRenderExportSettings,
  SceneGraphRenderOptions,
} from "../../scene-graph/render";
import {
  createWebGLSceneResourceIdentityStore,
  type WebGLSceneResourceIdentityStore,
  type WebGLSceneResourceKey,
} from "../resources/resource-identity";

type RenderTreeCacheEntry = {
  readonly resourceKey: WebGLSceneResourceKey;
  readonly tree: RenderTree;
  readonly exportSettings: FigmaRenderExportSettings | undefined;
};

function requireSceneViewport(scene: SceneGraph): NonNullable<SceneGraph["viewport"]> {
  if (!scene.viewport) {
    throw new Error("WebGL render tree cache requires scene.viewport");
  }
  return scene.viewport;
}

export type RenderTreeResolver = (scene: SceneGraph, options?: SceneGraphRenderOptions) => RenderTree;

export type WebGLRenderTreeCache = {
  readonly get: (scene: SceneGraph, options?: SceneGraphRenderOptions) => RenderTree;
  readonly clear: () => void;
};

/** Create a cache that reuses resolved RenderTree nodes across viewport-only changes. */
export function createWebGLRenderTreeCache(
  resolve: RenderTreeResolver = resolveRenderTree,
  sceneResources: WebGLSceneResourceIdentityStore = createWebGLSceneResourceIdentityStore(),
): WebGLRenderTreeCache {
  const current = { value: null as RenderTreeCacheEntry | null };

  return {
    get(scene: SceneGraph, options?: SceneGraphRenderOptions): RenderTree {
      const viewport = requireSceneViewport(scene);
      const cached = current.value;
      const resourceKey = sceneResources.get(scene);
      if (
        cached
        && sceneResources.isEqual(cached.resourceKey, resourceKey)
        && cached.exportSettings === options?.exportSettings
      ) {
        return { ...cached.tree, width: scene.width, height: scene.height, viewport };
      }

      const tree = resolve(scene, options);
      current.value = { resourceKey, tree, exportSettings: options?.exportSettings };
      return tree;
    },

    clear(): void {
      current.value = null;
    },
  };
}
