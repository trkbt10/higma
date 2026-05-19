/**
 * @file RenderTree cache for the WebGL renderer.
 *
 * Two paths share this cache:
 *
 * 1. **Viewport-only rerenders** (pan / zoom). The editor swaps the
 *    `viewport` rectangle but hands back the same `scene.root`. We
 *    return the cached `RenderTree` with the new viewport / size,
 *    preserving every RenderNode reference downstream.
 *
 * 2. **Document edits**. The editor produces a new `scene.root` (any
 *    mutation re-clones the root via `buildSceneGraphWithCache`), but
 *    `buildSceneGraphWithCache` keeps SceneNode references for every
 *    untouched node. We feed those references — and the previous
 *    resolution cache — to `resolveRenderTreeIncremental`, which keys
 *    its hits on `SceneNode` identity. Unchanged subtrees yield the
 *    same `RenderNode` instances they had last render, so every
 *    WeakMap cache keyed by RenderNode (path geometry, fill plan,
 *    local bounds, clip path vertices, effect stack…) stays warm
 *    across edits — only the edited subtree pays the resolve +
 *    tessellation cost.
 */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  resolveRenderTreeIncremental,
  type RenderTree,
  type RenderTreeResolutionCache,
} from "../../scene-graph";
import type {
  FigmaRenderExportSettings,
  SceneGraphRenderOptions,
} from "../../scene-graph";
import {
  createWebGLSceneResourceIdentityStore,
  type WebGLSceneResourceIdentityStore,
  type WebGLSceneResourceKey,
} from "../resources/resource-identity";

type RenderTreeCacheEntry = {
  readonly resourceKey: WebGLSceneResourceKey;
  readonly tree: RenderTree;
  readonly resolutionCache: RenderTreeResolutionCache;
  readonly exportSettings: FigmaRenderExportSettings | undefined;
};

function requireSceneViewport(scene: SceneGraph): NonNullable<SceneGraph["viewport"]> {
  if (!scene.viewport) {
    throw new Error("WebGL render tree cache requires scene.viewport");
  }
  return scene.viewport;
}

export type WebGLRenderTreeCache = {
  readonly get: (scene: SceneGraph, options?: SceneGraphRenderOptions) => RenderTree;
  readonly clear: () => void;
};

/**
 * Custom resolver injection hook used by tests. Production callers
 * go through the default `resolveRenderTreeIncremental` so SceneNode
 * identity across edits drives RenderNode reuse.
 */
export type WebGLRenderTreeIncrementalResolver = (
  scene: SceneGraph,
  previousCache: RenderTreeResolutionCache | undefined,
  options?: SceneGraphRenderOptions,
) => { readonly renderTree: RenderTree; readonly cache: RenderTreeResolutionCache };

/** Create a cache that reuses resolved RenderTree nodes across viewport-only changes and document edits. */
export function createWebGLRenderTreeCache(
  sceneResources: WebGLSceneResourceIdentityStore = createWebGLSceneResourceIdentityStore(),
  resolveIncremental: WebGLRenderTreeIncrementalResolver = resolveRenderTreeIncremental,
): WebGLRenderTreeCache {
  const current = { value: null as RenderTreeCacheEntry | null };

  return {
    get(scene: SceneGraph, options?: SceneGraphRenderOptions): RenderTree {
      const viewport = requireSceneViewport(scene);
      const cached = current.value;
      const resourceKey = sceneResources.get(scene);
      const exportSettingsChanged = cached !== null && cached.exportSettings !== options?.exportSettings;

      // Fast path: pan / zoom hands back the same `scene.root`, so
      // every RenderNode reference is already valid. Only the
      // viewport rectangle and surface size need to refresh.
      if (
        cached
        && !exportSettingsChanged
        && sceneResources.isEqual(cached.resourceKey, resourceKey)
      ) {
        return { ...cached.tree, width: scene.width, height: scene.height, viewport };
      }

      // Edit path: an edit changed the scene root. Resolve
      // incrementally so SceneNode references that survived the
      // edit yield their cached RenderNode references; downstream
      // node-keyed WeakMaps (path geometry, bounds, fill plans, etc.)
      // stay warm for every untouched node. When the export settings
      // change we drop the previous cache so the resolver can't reuse
      // settings-sensitive intermediates.
      const previousResolution = !cached || exportSettingsChanged ? undefined : cached.resolutionCache;
      const resolved = resolveIncremental(scene, previousResolution, options);
      current.value = {
        resourceKey,
        tree: resolved.renderTree,
        resolutionCache: resolved.cache,
        exportSettings: options?.exportSettings,
      };
      return resolved.renderTree;
    },

    clear(): void {
      current.value = null;
    },
  };
}
