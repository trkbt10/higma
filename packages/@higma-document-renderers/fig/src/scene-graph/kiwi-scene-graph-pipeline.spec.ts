/** @file Kiwi SceneGraph pipeline tests. */

import { createFigDocumentContextFromNodeChanges, figDocumentResources } from "@higma-document-io/fig";
import { BLEND_MODE_VALUES, NODE_TYPE_VALUES, PAINT_TYPE_VALUES, type BlendMode } from "@higma-document-models/fig/constants";
import type { FigColor, FigGuid, FigMatrix, FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { createKiwiSceneGraphPipeline, type KiwiSceneGraphMutation } from "./kiwi-scene-graph-pipeline";
import type { SceneGraph } from "./model";

const INITIAL_KIWI_SCENE_GRAPH_MUTATION: KiwiSceneGraphMutation = Object.freeze({
  revision: 0,
  scope: "initial-load",
  changedGuidKeys: [],
});

const IDENTITY_MATRIX: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const NODE_PHASE_CREATED: KiwiEnumValue = { value: 0, name: "CREATED" };
function kiwiGuid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function nodeTypeValue(name: "CANVAS" | "RECTANGLE"): KiwiEnumValue<"CANVAS" | "RECTANGLE"> {
  return { value: NODE_TYPE_VALUES[name], name };
}

function blendModeValue(name: BlendMode): KiwiEnumValue<BlendMode> {
  return { value: BLEND_MODE_VALUES[name], name };
}

function solidPaint(color: FigColor): NonNullable<FigNode["fillPaints"]>[number] {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    visible: true,
    opacity: 1,
    blendMode: blendModeValue("NORMAL"),
  };
}

function pageNode(): FigNode {
  return {
    guid: kiwiGuid(17, 1),
    phase: NODE_PHASE_CREATED,
    type: nodeTypeValue("CANVAS"),
    name: "Page",
    transform: IDENTITY_MATRIX,
    visible: true,
    opacity: 1,
    blendMode: blendModeValue("PASS_THROUGH"),
  };
}

function rectNode(localID: number, parent: FigNode, x: number, color: FigColor): FigNode {
  if (parent.guid === undefined) {
    throw new Error("rectNode requires parent guid");
  }
  return {
    guid: kiwiGuid(17, localID),
    phase: NODE_PHASE_CREATED,
    parentIndex: { guid: parent.guid, position: String(localID) },
    type: nodeTypeValue("RECTANGLE"),
    name: `Rect ${localID}`,
    transform: { ...IDENTITY_MATRIX, m02: x },
    visible: true,
    opacity: 1,
    blendMode: blendModeValue("NORMAL"),
    size: { x: 50, y: 50 },
    fillPaints: [solidPaint(color)],
  };
}

function requireSceneGraph(sceneGraph: SceneGraph | null): SceneGraph {
  if (sceneGraph === null) {
    throw new Error("Kiwi SceneGraph pipeline spec requires a non-null SceneGraph");
  }
  return sceneGraph;
}

function firstRootChild(sceneGraph: SceneGraph | null): SceneGraph["root"]["children"][number] {
  const child = requireSceneGraph(sceneGraph).root.children[0];
  if (child === undefined) {
    throw new Error("Kiwi SceneGraph pipeline spec requires a first root child");
  }
  return child;
}

function secondRootChild(sceneGraph: SceneGraph | null): SceneGraph["root"]["children"][number] {
  const child = requireSceneGraph(sceneGraph).root.children[1];
  if (child === undefined) {
    throw new Error("Kiwi SceneGraph pipeline spec requires a second root child");
  }
  return child;
}

describe("createKiwiSceneGraphPipeline", () => {
  it("uses the Kiwi document mutation revision as the SceneGraph version", () => {
    const page = pageNode();
    const rect = rectNode(2, page, 0, { r: 1, g: 0, b: 0, a: 1 });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, rect],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const sceneGraph = createKiwiSceneGraphPipeline().resolve({
      page,
      nodes: [rect],
      kiwiDocumentMutation: { revision: 7, scope: "node-content", changedGuidKeys: ["17:2"] },
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: false,
      resources: figDocumentResources(context),
    });

    expect(sceneGraph?.version).toBe(7);
  });

  it("uses the indexed Kiwi document object as the SceneGraph source document reference", () => {
    const page = pageNode();
    const rect = rectNode(2, page, 0, { r: 1, g: 0, b: 0, a: 1 });
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, rect],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const resources = figDocumentResources(context);
    const sceneGraph = createKiwiSceneGraphPipeline().resolve({
      page,
      nodes: [rect],
      kiwiDocumentMutation: INITIAL_KIWI_SCENE_GRAPH_MUTATION,
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: false,
      resources,
    });

    expect(sceneGraph?.sourceDocumentReference).toBe(resources.document);
  });

  it("uses showHiddenNodes as an explicit SceneGraph cache key", () => {
    const page = pageNode();
    const visible = rectNode(2, page, 0, { r: 1, g: 0, b: 0, a: 1 });
    const hidden = { ...rectNode(3, page, 80, { r: 0, g: 0, b: 1, a: 1 }), visible: false };
    const context = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, visible, hidden],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const pipeline = createKiwiSceneGraphPipeline();
    const withoutHidden = pipeline.resolve({
      page,
      nodes: [visible, hidden],
      kiwiDocumentMutation: INITIAL_KIWI_SCENE_GRAPH_MUTATION,
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: false,
      resources: figDocumentResources(context),
    });
    const withHidden = pipeline.resolve({
      page,
      nodes: [visible, hidden],
      kiwiDocumentMutation: INITIAL_KIWI_SCENE_GRAPH_MUTATION,
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: true,
      resources: figDocumentResources(context),
    });

    expect(requireSceneGraph(withoutHidden).root.children).toHaveLength(1);
    expect(requireSceneGraph(withHidden).root.children).toHaveLength(2);
  });

  it("reuses unchanged sibling SceneNodes for transform-only Kiwi node mutations", () => {
    const page = pageNode();
    const moving = rectNode(2, page, 0, { r: 1, g: 0, b: 0, a: 1 });
    const stable = rectNode(3, page, 80, { r: 0, g: 0, b: 1, a: 1 });
    const firstContext = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, moving, stable],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const pipeline = createKiwiSceneGraphPipeline();
    const first = pipeline.resolve({
      page,
      nodes: [moving, stable],
      kiwiDocumentMutation: INITIAL_KIWI_SCENE_GRAPH_MUTATION,
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: false,
      resources: figDocumentResources(firstContext),
    });
    const moved = { ...moving, transform: { ...IDENTITY_MATRIX, m02: 20 } };
    const nextContext = createFigDocumentContextFromNodeChanges({
      nodeChanges: [page, moved, stable],
      blobs: [],
      images: new Map(),
      metadata: null,
    });
    const second = pipeline.resolve({
      page,
      nodes: [moved, stable],
      kiwiDocumentMutation: { revision: 1, scope: "node-content", changedGuidKeys: ["17:2"] },
      canvasWidth: 200,
      canvasHeight: 100,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: 200,
      viewportHeight: 100,
      showHiddenNodes: false,
      resources: figDocumentResources(nextContext),
    });

    expect(firstRootChild(second)).not.toBe(firstRootChild(first));
    expect(secondRootChild(second)).toBe(secondRootChild(first));
  });
});
