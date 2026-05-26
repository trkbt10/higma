/** @file SceneGraph node bounds tests. */

import { createNodeId, type GroupNode, type PathNode, type RectNode, type SceneGraph } from "./model";
import { flattenSceneGraphNodeBounds } from "./node-bounds";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
const NODE_BOUNDS_SPEC_SOURCE_DOCUMENT_REFERENCE = Object.freeze({});
type ContourBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function rect(id: string, x: number, y: number, width: number, height: number): RectNode {
  return {
    id: createNodeId(id),
    type: "rect",
    transform: { ...IDENTITY, m02: x, m12: y },
    opacity: 1,
    visible: true,
    effects: [],
    width,
    height,
    fills: [],
  };
}

function path(
  id: string,
  x: number,
  y: number,
  contourBounds: ContourBounds | undefined,
): PathNode {
  return {
    id: createNodeId(id),
    type: "path",
    transform: { ...IDENTITY, m02: x, m12: y },
    opacity: 1,
    visible: true,
    effects: [],
    contours: contourBoundsToPathContours(contourBounds),
    fills: [],
  };
}

function contourBoundsToPathContours(contourBounds: ContourBounds | undefined): PathNode["contours"] {
  if (contourBounds === undefined) {
    return [];
  }
  return [{
    windingRule: "nonzero",
    commands: [
      { type: "M", x: contourBounds.x, y: contourBounds.y },
      { type: "L", x: contourBounds.x + contourBounds.width, y: contourBounds.y },
      { type: "L", x: contourBounds.x + contourBounds.width, y: contourBounds.y + contourBounds.height },
      { type: "L", x: contourBounds.x, y: contourBounds.y + contourBounds.height },
      { type: "Z" },
    ],
  }];
}

function group(
  id: string,
  x: number,
  y: number,
  children: readonly RectNode[],
  rendererStructure?: GroupNode["rendererStructure"],
): GroupNode {
  return {
    id: createNodeId(id),
    type: "group",
    ...(rendererStructure === undefined ? {} : { rendererStructure }),
    transform: { ...IDENTITY, m02: x, m12: y },
    opacity: 1,
    visible: true,
    effects: [],
    children,
  };
}

function scene(children: SceneGraph["root"]["children"]): SceneGraph {
  return {
    width: 500,
    height: 400,
    version: 1,
    sourceDocumentReference: NODE_BOUNDS_SPEC_SOURCE_DOCUMENT_REFERENCE,
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

describe("flattenSceneGraphNodeBounds", () => {
  it("flattens SceneGraph transforms into page-coordinate bounds", () => {
    const bounds = flattenSceneGraphNodeBounds(scene([rect("70:1", 20, 30, 100, 50)]));

    expect(bounds).toEqual([{
      id: "70:1",
      rootId: "70:1",
      x: 20,
      y: 30,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 20, y: 30, width: 100, height: 50 },
    }]);
  });

  it("derives group bounds from resolved child SceneGraph positions", () => {
    const bounds = flattenSceneGraphNodeBounds(scene([
      group("70:1", 10, 20, [
        rect("70:2", 5, 6, 30, 40),
        rect("70:3", 50, 60, 20, 10),
      ]),
    ]));

    expect(bounds[0]).toMatchObject({
      id: "70:1",
      rootId: "70:1",
      x: 15,
      y: 26,
      width: 65,
      height: 64,
    });
    expect(bounds[1]).toMatchObject({ id: "70:2", rootId: "70:1", x: 15, y: 26 });
    expect(bounds[2]).toMatchObject({ id: "70:3", rootId: "70:1", x: 60, y: 80 });
  });

  it("does not publish renderer mask-wrapper bounds as Kiwi node bounds", () => {
    const bounds = flattenSceneGraphNodeBounds(scene([
      group("masked-group-0", 10, 20, [
        rect("70:6", 5, 6, 30, 40),
      ], { kind: "mask-wrapper" }),
    ]));

    expect(bounds).toEqual([{
      id: "70:6",
      rootId: "70:6",
      x: 15,
      y: 26,
      width: 30,
      height: 40,
      rotation: 0,
      aabb: { x: 15, y: 26, width: 30, height: 40 },
    }]);
  });

  it("derives path bounds from SceneGraph contours when Kiwi omits node size", () => {
    const bounds = flattenSceneGraphNodeBounds(scene([
      path("70:4", 5, 6, { x: 10, y: 20, width: 100, height: 50 }),
    ]));

    expect(bounds).toEqual([{
      id: "70:4",
      rootId: "70:4",
      x: 15,
      y: 26,
      width: 100,
      height: 50,
      rotation: 0,
      aabb: { x: 15, y: 26, width: 100, height: 50 },
    }]);
  });

  it("fails when a path has neither contours nor explicit size", () => {
    expect(() => flattenSceneGraphNodeBounds(scene([path("70:5", 0, 0, undefined)])))
      .toThrow("SceneGraph node bounds require contours or explicit width and height for path node 70:5");
  });
});
