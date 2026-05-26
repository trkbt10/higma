/** @file SceneGraph node child accessor tests. */

import { createNodeId, type GroupNode, type RectNode } from "./model";
import {
  readSceneGraphNodeChildren,
  replaceSceneGraphNodeChildren,
  sceneGraphNodeOwnsChildren,
} from "./scene-graph-node-children";

const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

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

function group(children: readonly RectNode[]): GroupNode {
  return {
    id: createNodeId("group"),
    type: "group",
    transform: IDENTITY,
    opacity: 1,
    visible: true,
    effects: [],
    children,
  };
}

describe("SceneGraph node child accessors", () => {
  it("reads only the child list owned by group and frame nodes", () => {
    const child = rect("child");
    const parent = group([child]);

    expect(sceneGraphNodeOwnsChildren(parent)).toBe(true);
    expect(readSceneGraphNodeChildren(parent)).toEqual([child]);
    expect(sceneGraphNodeOwnsChildren(child)).toBe(false);
    expect(readSceneGraphNodeChildren(child)).toEqual([]);
  });

  it("replaces the child list without changing the input node", () => {
    const first = rect("first");
    const second = rect("second");
    const parent = group([first]);
    const replaced = replaceSceneGraphNodeChildren(parent, [second]);

    expect(replaced).not.toBe(parent);
    expect(replaced.children).toEqual([second]);
    expect(parent.children).toEqual([first]);
  });
});
