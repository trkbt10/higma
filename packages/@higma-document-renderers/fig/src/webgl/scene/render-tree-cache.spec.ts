/** @file WebGL RenderTree cache tests. */

import type { RenderTree } from "../../scene-graph/render-tree";
import type { GroupNode, SceneGraph, SceneNodeId } from "@higma-document-models/fig/scene-graph";
import type { FigmaRenderExportSettings, SceneGraphRenderOptions } from "../../scene-graph/render";
import { createWebGLRenderTreeCache } from "./render-tree-cache";

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

describe("createWebGLRenderTreeCache", () => {
  it("reuses resolved children when only the viewport changes", () => {
    const root = makeRoot();
    const calls = { value: 0 };
    const tree: RenderTree = { width: 500, height: 400, viewport: { x: 0, y: 0, width: 500, height: 400 }, children: [] };
    const cache = createWebGLRenderTreeCache((scene) => {
      calls.value += 1;
      return { ...tree, viewport: scene.viewport ?? tree.viewport };
    });

    expect(cache.get(makeScene(root, 0)).viewport.x).toBe(0);
    expect(cache.get(makeScene(root, 120)).viewport.x).toBe(120);
    expect(calls.value).toBe(1);
  });

  it("resolves again when the root changes", () => {
    const calls = { value: 0 };
    const tree: RenderTree = { width: 500, height: 400, viewport: { x: 0, y: 0, width: 500, height: 400 }, children: [] };
    const cache = createWebGLRenderTreeCache((scene) => {
      calls.value += 1;
      return { ...tree, viewport: scene.viewport ?? tree.viewport };
    });

    cache.get(makeScene(makeRoot(), 0));
    cache.get(makeScene(makeRoot(), 0));

    expect(calls.value).toBe(2);
  });

  it("forwards exportSettings to the resolver and reuses the cache while they are stable", () => {
    const root = makeRoot();
    const received: Array<FigmaRenderExportSettings | undefined> = [];
    const tree: RenderTree = { width: 500, height: 400, viewport: { x: 0, y: 0, width: 500, height: 400 }, children: [] };
    const cache = createWebGLRenderTreeCache((scene, options) => {
      received.push(options?.exportSettings);
      return { ...tree, viewport: scene.viewport ?? tree.viewport };
    });
    const stableSettings: FigmaRenderExportSettings = { colorProfile: "SRGB" };
    const optionsA: SceneGraphRenderOptions = { exportSettings: stableSettings };

    cache.get(makeScene(root, 0), optionsA);
    cache.get(makeScene(root, 120), optionsA);

    expect(received).toEqual([stableSettings]);
  });

  it("re-resolves when exportSettings change for the same scene", () => {
    const root = makeRoot();
    const calls = { value: 0 };
    const tree: RenderTree = { width: 500, height: 400, viewport: { x: 0, y: 0, width: 500, height: 400 }, children: [] };
    const cache = createWebGLRenderTreeCache((scene) => {
      calls.value += 1;
      return { ...tree, viewport: scene.viewport ?? tree.viewport };
    });

    cache.get(makeScene(root, 0), { exportSettings: { colorProfile: "SRGB" } });
    cache.get(makeScene(root, 0), { exportSettings: { colorProfile: "SRGB" } });

    expect(calls.value).toBe(2);
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
