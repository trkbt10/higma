/**
 * @file RenderTree cache for the WebGL renderer.
 *
 * Two paths share this cache:
 *
 * 1. **Exact-root viewport rerenders**. When pan / zoom changes only
 *    `scene.viewport` and keeps `scene.root` by reference, we return
 *    the cached `RenderTree` with the new viewport / size, preserving
 *    every RenderNode reference downstream.
 *
 * 2. **Document edits**. Actual edits produce a new root, while the
 *    editor keeps viewport movement on the same `scene.root`. In both cases
 *    `buildSceneGraphWithCache` keeps SceneNode references for every
 *    untouched source FigNode. We feed the previous reference reuse
 *    state to `resolveRenderTreeWithReferenceReuse`, which keys its
 *    hits on `SceneNode` object reference. Unchanged subtrees
 *    yield the same `RenderNode` instances they had last render, so
 *    every WeakMap cache keyed by RenderNode (path geometry, fill
 *    plan, local bounds, clip path vertices, effect stack…) stays
 *    warm. Only the newly visible or edited subtree pays the resolve
 *    and tessellation cost.
 */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  renderExportSettingsCacheKey,
  resolveFigmaRenderExportSettings,
  resolveRenderTreeWithReferenceReuse,
  type RenderTree,
  type RenderTreeReferenceReuseState,
} from "../../scene-graph";
import type {
  RenderExportSettingsCacheKey,
  SceneGraphRenderOptions,
} from "../../scene-graph";
import {
  areWebGLSceneResourceReferenceKeysEqual,
  createWebGLSceneResourceReferenceKey,
  type WebGLSceneResourceReferenceKey,
} from "../resources/scene-resource-reference-key";

type RenderTreeCacheEntry = {
  readonly resourceKey: WebGLSceneResourceReferenceKey;
  readonly sceneRoot: SceneGraph["root"];
  readonly tree: RenderTree;
  readonly referenceReuseState: RenderTreeReferenceReuseState;
  readonly exportSettingsKey: RenderExportSettingsCacheKey;
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
 * go through the default `resolveRenderTreeWithReferenceReuse` so
 * SceneNode object references across edits drive RenderNode reuse.
 */
export type WebGLRenderTreeReferenceReuseResolver = (
  scene: SceneGraph,
  previousState: RenderTreeReferenceReuseState | undefined,
  options?: SceneGraphRenderOptions,
) => { readonly renderTree: RenderTree; readonly referenceReuseState: RenderTreeReferenceReuseState };

function sceneGraphRenderOptionsCacheKey(options: SceneGraphRenderOptions | undefined): RenderExportSettingsCacheKey {
  return renderExportSettingsCacheKey(resolveFigmaRenderExportSettings(options?.exportSettings));
}

/** Create a cache that reuses resolved RenderTree nodes across viewport-only changes and document edits. */
export function createWebGLRenderTreeCache(
  resolveWithReferenceReuse: WebGLRenderTreeReferenceReuseResolver = resolveRenderTreeWithReferenceReuse,
): WebGLRenderTreeCache {
  const current = { value: null as RenderTreeCacheEntry | null };

  return {
    get(scene: SceneGraph, options?: SceneGraphRenderOptions): RenderTree {
      const viewport = requireSceneViewport(scene);
      const cached = current.value;
      const resourceKey = createWebGLSceneResourceReferenceKey(scene);
      const exportSettingsKey = sceneGraphRenderOptionsCacheKey(options);
      const exportSettingsChanged = cached !== null && cached.exportSettingsKey !== exportSettingsKey;

      // Fast path: pan / zoom hands back the same `scene.root`, so
      // every RenderNode reference is already valid. Only the
      // viewport rectangle and surface size need to refresh.
      if (
        cached
        && !exportSettingsChanged
        && cached.sceneRoot === scene.root
        && areWebGLSceneResourceReferenceKeysEqual(cached.resourceKey, resourceKey)
      ) {
        return { ...cached.tree, width: scene.width, height: scene.height, viewport };
      }

      // Edit path: an edit changed the scene root. Resolve with
      // reference reuse so SceneNode references that survived the
      // edit yield their previous RenderNode references; downstream
      // node-keyed WeakMaps (path geometry, bounds, fill plans, etc.)
      // stay warm for every untouched node. When the export settings
      // change we drop the previous cache so the resolver can't reuse
      // settings-sensitive intermediates.
      const previousReferenceReuseState = !cached || exportSettingsChanged ? undefined : cached.referenceReuseState;
      const resolved = resolveWithReferenceReuse(scene, previousReferenceReuseState, options);
      current.value = {
        resourceKey,
        sceneRoot: scene.root,
        tree: resolved.renderTree,
        referenceReuseState: resolved.referenceReuseState,
        exportSettingsKey,
      };
      return resolved.renderTree;
    },

    clear(): void {
      current.value = null;
    },
  };
}
