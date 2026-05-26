/** @file Canvas interaction target resolution tests over Kiwi GUIDs. */

import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { resolveInteractionTargetGuid } from "./target-resolution";

function guid(localID: number): FigGuid {
  return { sessionID: 71, localID };
}

function figNode(localID: number, parent: FigGuid | undefined): FigNode {
  return {
    guid: guid(localID),
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    name: `node-${localID}`,
    parentIndex: parent === undefined ? undefined : { guid: parent, position: `${localID}` },
    visible: true,
    opacity: 1,
  };
}

function bounds(id: string, rootId: string, x: number, y: number, width: number, height: number): SceneGraphNodeBounds {
  return {
    id,
    rootId,
    x,
    y,
    width,
    height,
    rotation: 0,
    aabb: { x, y, width, height },
  };
}

describe("resolveInteractionTargetGuid", () => {
  it("chooses the deepest bounds containing the point", () => {
    const parent = figNode(1, undefined);
    const child = figNode(2, parent.guid);
    const document = indexFigKiwiDocument([parent, child]);
    const result = resolveInteractionTargetGuid({
      document,
      itemBounds: [
        bounds("71:1", "71:1", 100, 100, 140, 100),
        bounds("71:2", "71:1", 120, 120, 40, 30),
      ],
      point: { x: 125, y: 125 },
    });

    expect(result).toEqual(child.guid);
  });

  it("throws when no renderer-derived bounds contain the point", () => {
    const parent = figNode(1, undefined);
    const child = figNode(2, parent.guid);
    const document = indexFigKiwiDocument([parent, child]);
    expect(() => resolveInteractionTargetGuid({
      document,
      itemBounds: [
        bounds("71:1", "71:1", 100, 100, 140, 100),
        bounds("71:2", "71:1", 120, 120, 40, 30),
      ],
      point: { x: 10, y: 10 },
    })).toThrow("no rendered SceneGraph bounds contain point");
  });
});
