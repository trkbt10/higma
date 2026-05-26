/** @file SceneGraph node translation tests. */

import { createNodeId, type RectNode, type SceneGraph, type SceneNode } from "./model";
import {
  findSceneGraphNode,
  replaceSceneGraphNodeTransform,
  translateSceneGraphNode,
  translateSceneNodeTransform,
} from "./translate-scene-node";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const TRANSLATE_SCENE_NODE_SPEC_SOURCE_DOCUMENT_REFERENCE = Object.freeze({});

function rect(id: string): RectNode {
  return {
    id: createNodeId(id),
    type: "rect",
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    width: 10,
    height: 10,
    fills: [],
  };
}

function scene(children: readonly SceneNode[]): SceneGraph {
  return {
    width: 100,
    height: 100,
    version: 1,
    sourceDocumentReference: TRANSLATE_SCENE_NODE_SPEC_SOURCE_DOCUMENT_REFERENCE,
    root: {
      id: createNodeId("root"),
      type: "group",
      transform: IDENTITY,
      opacity: 1,
      visible: true,
      effects: [],
      children,
    },
  };
}

describe("translateSceneGraphNode", () => {
  it("uses the same local transform projection exposed to WebGL transient rendering", () => {
    expect(translateSceneNodeTransform(IDENTITY, 12, 4)).toMatchObject({ m02: 12, m12: 4 });
  });

  it("translates only the requested SceneNode while preserving sibling identity", () => {
    const first = rect("first");
    const second = rect("second");
    const original = scene([first, second]);
    const translated = translateSceneGraphNode(original, {
      nodeId: createNodeId("first"),
      dx: 12,
      dy: 4,
    });

    expect(translated.root).not.toBe(original.root);
    expect(translated.root.children[0]).not.toBe(first);
    expect(translated.root.children[0]?.transform).toMatchObject({ m02: 12, m12: 4 });
    expect(translated.root.children[1]).toBe(second);
  });

  it("throws when the requested SceneNode is not in the SceneGraph", () => {
    expect(() => translateSceneGraphNode(scene([rect("first")]), {
      nodeId: createNodeId("missing"),
      dx: 1,
      dy: 1,
    })).toThrow("SceneNode missing is not present");
  });
});

describe("replaceSceneGraphNodeTransform", () => {
  it("finds and replaces one SceneNode local transform while preserving sibling identity", () => {
    const first = rect("first");
    const second = rect("second");
    const original = scene([first, second]);
    const nextTransform = { ...IDENTITY, m02: 8, m12: 9 };
    const replaced = replaceSceneGraphNodeTransform(original, createNodeId("first"), nextTransform);

    expect(findSceneGraphNode(replaced, createNodeId("first"))?.transform).toEqual(nextTransform);
    expect(replaced.root.children[0]).not.toBe(first);
    expect(replaced.root.children[1]).toBe(second);
  });

  it("throws when the replaced SceneNode is missing", () => {
    expect(() => replaceSceneGraphNodeTransform(
      scene([rect("first")]),
      createNodeId("missing"),
      IDENTITY,
    )).toThrow("SceneNode missing is not present");
  });
});
