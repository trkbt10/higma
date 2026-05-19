/** @file WebGL RenderTree cache tests. */

import { resolveRenderTreeIncremental, type RenderTree, type RenderTreeResolutionCache } from "../../scene-graph";
import type { GroupNode, SceneGraph, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import type { FigmaRenderExportSettings, SceneGraphRenderOptions } from "../../scene-graph";
import { createWebGLRenderTreeCache, type WebGLRenderTreeIncrementalResolver } from "./render-tree-cache";

function makeRoot(): GroupNode {
  return {
    id: "root" as SceneNodeId,
    type: "group",
    name: "root",
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    children: [],
  };
}

function makeScene(root: GroupNode, viewportX: number): SceneGraph {
  return {
    width: 500,
    height: 400,
    viewport: { x: viewportX, y: 0, width: 500, height: 400 },
    root,
    version: 1,
  };
}

type Spy = {
  readonly resolver: WebGLRenderTreeIncrementalResolver;
  readonly calls: Array<{
    readonly receivedPreviousCache: boolean;
    readonly exportSettings: FigmaRenderExportSettings | undefined;
  }>;
};

/**
 * Build a real `RenderTreeResolutionCache` for the given export
 * settings by running the real resolver once against an empty scene.
 * The branded `exportSettingsKey` field is module-internal, so this
 * is the canonical way to produce a valid cache from the public
 * surface without re-deriving the branding by hand.
 */
function realCache(exportSettings?: FigmaRenderExportSettings): RenderTreeResolutionCache {
  const emptyScene: SceneGraph = {
    width: 1,
    height: 1,
    viewport: { x: 0, y: 0, width: 1, height: 1 },
    root: makeRoot(),
    version: 1,
  };
  return resolveRenderTreeIncremental(emptyScene, undefined, exportSettings ? { exportSettings } : undefined).cache;
}

function makeSpy(): Spy {
  const calls: Spy["calls"] = [];
  const resolver: WebGLRenderTreeIncrementalResolver = (scene, previousCache, options) => {
    calls.push({
      receivedPreviousCache: previousCache !== undefined,
      exportSettings: options?.exportSettings,
    });
    const renderTree: RenderTree = {
      width: scene.width,
      height: scene.height,
      viewport: scene.viewport ?? { x: 0, y: 0, width: scene.width, height: scene.height },
      children: [],
    };
    return { renderTree, cache: realCache(options?.exportSettings) };
  };
  return { resolver, calls };
}

describe("createWebGLRenderTreeCache", () => {
  it("reuses resolved children when only the viewport changes (pan/zoom fast path)", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(undefined, spy.resolver);

    expect(cache.get(makeScene(root, 0)).viewport.x).toBe(0);
    expect(cache.get(makeScene(root, 120)).viewport.x).toBe(120);
    // Only one resolve — the second call returned the cached tree
    // with a swapped viewport rectangle.
    expect(spy.calls).toHaveLength(1);
  });

  it("passes the previous resolution cache into the resolver when the scene root changes (edit path)", () => {
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(undefined, spy.resolver);

    cache.get(makeScene(makeRoot(), 0));
    cache.get(makeScene(makeRoot(), 0));

    expect(spy.calls).toHaveLength(2);
    // The bootstrap pass has no previous cache; the second pass must
    // see the first call's cache so unchanged SceneNodes can be
    // reused downstream.
    expect(spy.calls.map((c) => c.receivedPreviousCache)).toEqual([false, true]);
  });

  it("forwards exportSettings to the resolver and keeps the fast path while they are stable", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(undefined, spy.resolver);
    const stableSettings: FigmaRenderExportSettings = { colorProfile: "SRGB" };
    const options: SceneGraphRenderOptions = { exportSettings: stableSettings };

    cache.get(makeScene(root, 0), options);
    cache.get(makeScene(root, 120), options);

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].exportSettings).toBe(stableSettings);
  });

  it("drops the previous resolution cache when exportSettings change", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(undefined, spy.resolver);
    const settingsA: FigmaRenderExportSettings = { colorProfile: "SRGB" };
    const settingsB: FigmaRenderExportSettings = { colorProfile: "SRGB", pdfQuality: "HIGH" };

    cache.get(makeScene(root, 0), { exportSettings: settingsA });
    cache.get(makeScene(root, 0), { exportSettings: settingsB });

    expect(spy.calls).toHaveLength(2);
    // Settings-sensitive intermediates in the previous cache cannot
    // be reused, so the resolver receives `undefined` for the
    // export-settings-changed call.
    expect(spy.calls.map((c) => c.receivedPreviousCache)).toEqual([false, false]);
  });

  it("throws when scene viewport is missing", () => {
    const root = makeRoot();
    const cache = createWebGLRenderTreeCache();

    expect(() => cache.get({
      width: 500,
      height: 400,
      root,
      version: 1,
    })).toThrow("scene.viewport");
  });
});
