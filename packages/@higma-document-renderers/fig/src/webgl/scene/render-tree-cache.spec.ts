/** @file WebGL RenderTree cache tests. */

import { resolveRenderTreeWithReferenceReuse, type RenderTree, type RenderTreeReferenceReuseState } from "../../scene-graph";
import type { GroupNode, SceneGraph, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import type { FigmaRenderExportSettings, SceneGraphRenderOptions } from "../../scene-graph";
import { createWebGLRenderTreeCache, type WebGLRenderTreeReferenceReuseResolver } from "./render-tree-cache";

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

function makeScene(root: GroupNode, viewportX: number, sourceDocumentReference: object): SceneGraph {
  return {
    width: 500,
    height: 400,
    viewport: { x: viewportX, y: 0, width: 500, height: 400 },
    root,
    sourceDocumentReference,
    version: 1,
  };
}

type Spy = {
  readonly resolver: WebGLRenderTreeReferenceReuseResolver;
  readonly calls: Array<{
    readonly receivedPreviousState: boolean;
    readonly exportSettings: FigmaRenderExportSettings | undefined;
  }>;
};

/**
 * Build a real `RenderTreeReferenceReuseState` for the given export
 * settings by running the real resolver once against an empty scene.
 * The branded `exportSettingsKey` field is module-internal, so this
 * is the canonical way to produce a valid reuse state from the public
 * surface without re-deriving the branding by hand.
 */
function realReferenceReuseState(exportSettings?: FigmaRenderExportSettings): RenderTreeReferenceReuseState {
  const root = makeRoot();
  const emptyScene: SceneGraph = {
    width: 1,
    height: 1,
    viewport: { x: 0, y: 0, width: 1, height: 1 },
    root,
    sourceDocumentReference: root,
    version: 1,
  };
  return resolveRenderTreeWithReferenceReuse(emptyScene, undefined, exportSettings ? { exportSettings } : undefined).referenceReuseState;
}

function makeSpy(): Spy {
  const calls: Spy["calls"] = [];
  const resolver: WebGLRenderTreeReferenceReuseResolver = (scene, previousState, options) => {
    calls.push({
      receivedPreviousState: previousState !== undefined,
      exportSettings: options?.exportSettings,
    });
    const renderTree: RenderTree = {
      width: scene.width,
      height: scene.height,
      viewport: scene.viewport ?? { x: 0, y: 0, width: scene.width, height: scene.height },
      children: [],
    };
    return { renderTree, referenceReuseState: realReferenceReuseState(options?.exportSettings) };
  };
  return { resolver, calls };
}

describe("createWebGLRenderTreeCache", () => {
  it("reuses resolved children when only the viewport changes (pan/zoom fast path)", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);

    expect(cache.get(makeScene(root, 0, root)).viewport.x).toBe(0);
    expect(cache.get(makeScene(root, 120, root)).viewport.x).toBe(120);
    // Only one resolve — the second call returned the cached tree
    // with a swapped viewport rectangle.
    expect(spy.calls).toHaveLength(1);
  });

  it("passes the previous reference reuse state into the resolver when the scene root changes (edit path)", () => {
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);

    const firstRoot = makeRoot();
    const secondRoot = makeRoot();
    cache.get(makeScene(firstRoot, 0, firstRoot));
    cache.get(makeScene(secondRoot, 0, secondRoot));

    expect(spy.calls).toHaveLength(2);
    // The bootstrap pass has no previous reference reuse state; the
    // second pass must see the first call's state so unchanged SceneNodes can be
    // reused downstream.
    expect(spy.calls.map((c) => c.receivedPreviousState)).toEqual([false, true]);
  });

  it("resolves again when the scene root changes even if the source document reference is stable", () => {
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);
    const sourceDocumentReference = {};

    cache.get(makeScene(makeRoot(), 0, sourceDocumentReference));
    cache.get(makeScene(makeRoot(), 120, sourceDocumentReference));

    expect(spy.calls).toHaveLength(2);
    expect(spy.calls.map((c) => c.receivedPreviousState)).toEqual([false, true]);
  });

  it("forwards exportSettings to the resolver and keeps the fast path while they are stable", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);
    const stableSettings: FigmaRenderExportSettings = { colorProfile: "SRGB" };
    const options: SceneGraphRenderOptions = { exportSettings: stableSettings };

    cache.get(makeScene(root, 0, root), options);
    cache.get(makeScene(root, 120, root), options);

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].exportSettings).toBe(stableSettings);
  });

  it("keeps the fast path when equivalent exportSettings are passed as a new object", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);

    cache.get(makeScene(root, 0, root), { exportSettings: { colorProfile: "SRGB" } });
    cache.get(makeScene(root, 120, root), { exportSettings: { colorProfile: "SRGB" } });

    expect(spy.calls).toHaveLength(1);
  });

  it("drops the previous reference reuse state when exportSettings change", () => {
    const root = makeRoot();
    const spy = makeSpy();
    const cache = createWebGLRenderTreeCache(spy.resolver);
    const settingsA: FigmaRenderExportSettings = { colorProfile: "SRGB" };
    const settingsB: FigmaRenderExportSettings = { colorProfile: "SRGB", pdfQuality: "HIGH" };

    cache.get(makeScene(root, 0, root), { exportSettings: settingsA });
    cache.get(makeScene(root, 0, root), { exportSettings: settingsB });

    expect(spy.calls).toHaveLength(2);
    // Settings-sensitive intermediates in the previous state cannot
    // be reused, so the resolver receives `undefined` for the
    // export-settings-changed call.
    expect(spy.calls.map((c) => c.receivedPreviousState)).toEqual([false, false]);
  });

  it("throws when scene viewport is missing", () => {
    const root = makeRoot();
    const cache = createWebGLRenderTreeCache();

    expect(() => cache.get({
      width: 500,
      height: 400,
      root,
      sourceDocumentReference: root,
      version: 1,
    })).toThrow("scene.viewport");
  });
});
