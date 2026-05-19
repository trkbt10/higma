/** @file Canvas interaction target resolution tests over Kiwi GUIDs. */

import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { flattenAllNodeBounds } from "./bounds";
import { resolveInteractionTargetGuid } from "./target-resolution";

function guid(localID: number): FigGuid {
  return { sessionID: 71, localID };
}

function figNode(localID: number, parent: FigGuid | undefined, x: number, y: number, width: number, height: number): FigNode {
  return {
    guid: guid(localID),
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    name: `node-${localID}`,
    parentIndex: parent === undefined ? undefined : { guid: parent, position: `${localID}` },
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y },
    size: { x: width, y: height },
  };
}

describe("resolveInteractionTargetGuid", () => {
  it("chooses the deepest bounds containing the point", () => {
    const parent = figNode(1, undefined, 100, 100, 140, 100);
    const child = figNode(2, parent.guid, 20, 20, 40, 30);
    const document = indexFigKiwiDocument([parent, child]);
    const bounds = flattenAllNodeBounds(document, document.roots);
    const result = resolveInteractionTargetGuid({
      document,
      itemBounds: bounds,
      hitId: "71:1",
      point: { x: 125, y: 125 },
    });

    expect(result).toEqual(child.guid);
  });

  it("uses the browser hit id when the point is not inside a known bound", () => {
    const parent = figNode(1, undefined, 100, 100, 140, 100);
    const child = figNode(2, parent.guid, 20, 20, 40, 30);
    const document = indexFigKiwiDocument([parent, child]);
    const bounds = flattenAllNodeBounds(document, document.roots);
    const result = resolveInteractionTargetGuid({
      document,
      itemBounds: bounds,
      hitId: "71:1",
      point: { x: 10, y: 10 },
    });

    expect(result).toEqual(parent.guid);
  });
});
