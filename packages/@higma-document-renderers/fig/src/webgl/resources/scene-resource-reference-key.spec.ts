/** @file WebGL scene resource reference key tests. */

import type { SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import type { GroupNode, SceneNodeId } from "@higma-document-renderers/fig/scene-graph";
import { areWebGLSceneResourceReferenceKeysEqual, createWebGLSceneResourceReferenceKey } from "./scene-resource-reference-key";

function makeRoot(id: string): GroupNode {
  return {
    id: id as SceneNodeId,
    type: "group",
    name: id,
    visible: true,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    effects: [],
    children: [],
  };
}

function makeScene(
  root: GroupNode,
  version: number,
  viewportX: number,
  sourceDocumentReference: object,
): SceneGraph {
  return {
    root,
    sourceDocumentReference,
    width: 200,
    height: 100,
    version,
    viewport: { x: viewportX, y: 0, width: 200, height: 100 },
  };
}

describe("WebGL scene resource reference key", () => {
  it("keeps the same resource key when only the viewport changes", () => {
    const root = makeRoot("root");
    const first = createWebGLSceneResourceReferenceKey(makeScene(root, 7, 0, root));
    const second = createWebGLSceneResourceReferenceKey(makeScene(root, 7, 120, root));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(true);
  });

  it("keeps the same resource key when only the Kiwi document revision changes", () => {
    const root = makeRoot("root");
    const first = createWebGLSceneResourceReferenceKey(makeScene(root, 7, 0, root));
    const second = createWebGLSceneResourceReferenceKey(makeScene(root, 8, 0, root));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(true);
  });

  it("changes the resource key when the root reference changes", () => {
    const firstRoot = makeRoot("first");
    const secondRoot = makeRoot("second");
    const first = createWebGLSceneResourceReferenceKey(makeScene(firstRoot, 7, 0, firstRoot));
    const second = createWebGLSceneResourceReferenceKey(makeScene(secondRoot, 7, 0, secondRoot));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(false);
  });

  it("changes the resource key when viewport pruning rebuilds a different scene root", () => {
    const sourceDocumentReference = {};
    const first = createWebGLSceneResourceReferenceKey(makeScene(makeRoot("visible-first"), 7, 0, sourceDocumentReference));
    const second = createWebGLSceneResourceReferenceKey(makeScene(makeRoot("visible-second"), 7, 120, sourceDocumentReference));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(false);
  });

  it("changes the resource key when a Kiwi document reference is stable but the scene root changes", () => {
    const kiwiDocumentReference = {};
    const first = createWebGLSceneResourceReferenceKey(makeScene(makeRoot("visible-first"), 7, 0, kiwiDocumentReference));
    const second = createWebGLSceneResourceReferenceKey(makeScene(makeRoot("visible-second"), 7, 120, kiwiDocumentReference));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(false);
  });

  it("changes the resource key when the source document reference changes", () => {
    const root = makeRoot("root");
    const first = createWebGLSceneResourceReferenceKey(makeScene(root, 1, 0, {}));
    const second = createWebGLSceneResourceReferenceKey(makeScene(root, 1, 0, {}));

    expect(areWebGLSceneResourceReferenceKeysEqual(first, second)).toBe(false);
  });
});
