/** @file WebGL visible resource preparation reference key tests. */

import { createNodeId, type GroupNode, type SceneGraph } from "@higma-document-renderers/fig/scene-graph";
import {
  areWebGLVisibleResourcePreparationKeysEqual,
  createWebGLVisibleResourcePreparationKey,
} from "./visible-resource-preparation-key";

function makeRoot(name: string): GroupNode {
  return {
    id: createNodeId(name),
    name,
    type: "group",
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    opacity: 1,
    visible: true,
    effects: [],
    children: [],
  };
}

function makeScene(
  root: GroupNode,
  viewport: NonNullable<SceneGraph["viewport"]> | undefined,
  version = 1,
): SceneGraph {
  return {
    width: 200,
    height: 100,
    viewport,
    root,
    version,
    sourceDocumentReference: root,
  };
}

describe("WebGL visible resource preparation reference key", () => {
  function createKey(
    scene: SceneGraph,
    visibleTextureResourceIds: readonly string[] = [],
  ) {
    return createWebGLVisibleResourcePreparationKey({
      scene,
      visibleTextureResourceIds,
    });
  }

  it("keeps one prepared key valid for the same document root and same viewport", () => {
    const root = makeRoot("root");
    const first = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }),
      ["image-a"],
    );
    const second = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }),
      ["image-a"],
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(true);
  });

  it("keeps prepared scene resources valid when viewport changes but the visible texture set is unchanged", () => {
    const root = makeRoot("root");
    const first = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }),
      ["image-a"],
    );
    const second = createKey(
      makeScene(root, { x: 120, y: 0, width: 200, height: 100 }),
      ["image-a"],
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(true);
  });

  it("invalidates prepared visible resources when viewport motion reveals a different texture set", () => {
    const root = makeRoot("root");
    const first = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }),
      ["image-a"],
    );
    const second = createKey(
      makeScene(root, { x: 120, y: 0, width: 200, height: 100 }),
      ["image-a", "image-b"],
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(false);
  });

  it("keeps prepared visible resources valid when the same visible texture set is observed in a different order", () => {
    const root = makeRoot("root");
    const first = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }),
      ["image-b", "image-a"],
    );
    const second = createKey(
      makeScene(root, { x: 120, y: 0, width: 200, height: 100 }),
      ["image-a", "image-b"],
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(true);
  });

  it("keeps prepared scene resources valid when only the document revision changes", () => {
    const root = makeRoot("root");
    const first = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }, 1),
      ["image-a"],
    );
    const second = createKey(
      makeScene(root, { x: 0, y: 0, width: 200, height: 100 }, 2),
      ["image-a"],
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(true);
  });

  it("invalidates prepared visible resources when the document root changes", () => {
    const first = createKey(
      makeScene(makeRoot("first"), { x: 0, y: 0, width: 200, height: 100 }),
    );
    const second = createKey(
      makeScene(makeRoot("second"), { x: 0, y: 0, width: 200, height: 100 }),
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(false);
  });

  it("invalidates prepared visible resources when the source document reference is stable but the scene root changes", () => {
    const sourceDocumentReference = {};
    const firstRoot = makeRoot("first");
    const secondRoot = makeRoot("second");
    const first = createKey(
      { ...makeScene(firstRoot, { x: 0, y: 0, width: 200, height: 100 }), sourceDocumentReference },
    );
    const second = createKey(
      { ...makeScene(secondRoot, { x: 0, y: 0, width: 200, height: 100 }), sourceDocumentReference },
    );

    expect(areWebGLVisibleResourcePreparationKeysEqual(first, second)).toBe(false);
  });

  it("requires an explicit viewport", () => {
    expect(() => createKey(makeScene(makeRoot("root"), undefined)))
      .toThrow("scene.viewport");
  });

  it("rejects duplicate visible texture resource ids", () => {
    expect(() => createKey(
      makeScene(makeRoot("root"), { x: 0, y: 0, width: 200, height: 100 }),
      ["image-a", "image-a"],
    )).toThrow("duplicate texture resource image-a");
  });
});
