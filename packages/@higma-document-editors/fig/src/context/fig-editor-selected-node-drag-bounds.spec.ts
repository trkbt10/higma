/** @file Selected Kiwi node drag bounds projection tests. */
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import {
  figEditorSelectedNodeDragMovesBounds,
  translateFigEditorSelectedNodeDragBoundsList,
} from "./fig-editor-selected-node-drag-bounds";
import { sectionGuid, sectionNode } from "../panels/sections/section-specimen";

const PARENT_GUID = sectionGuid(501);
const CHILD_GUID = sectionGuid(502);
const SIBLING_GUID = sectionGuid(503);

function bounds(id: string, x: number): SceneGraphNodeBounds {
  return {
    id,
    rootId: id,
    x,
    y: 5,
    width: 10,
    height: 20,
    rotation: 0,
    aabb: { x, y: 5, width: 10, height: 20 },
  };
}

function nodesByGuid(): ReadonlyMap<string, FigNode> {
  const parent = sectionNode("FRAME", { guid: PARENT_GUID });
  const child = sectionNode("RECTANGLE", {
    guid: CHILD_GUID,
    parentIndex: { guid: PARENT_GUID, position: "a" },
  });
  const sibling = sectionNode("RECTANGLE", { guid: SIBLING_GUID });
  return new Map([
    [guidToString(PARENT_GUID), parent],
    [guidToString(CHILD_GUID), child],
    [guidToString(SIBLING_GUID), sibling],
  ]);
}

describe("figEditorSelectedNodeDragBounds", () => {
  it("moves the dragged Kiwi node and descendants while preserving sibling bounds identity", () => {
    const parentBounds = bounds(guidToString(PARENT_GUID), 10);
    const childBounds = bounds(guidToString(CHILD_GUID), 20);
    const siblingBounds = bounds(guidToString(SIBLING_GUID), 30);
    const translated = translateFigEditorSelectedNodeDragBoundsList(
      nodesByGuid(),
      [parentBounds, childBounds, siblingBounds],
      { draggedGuidKey: guidToString(PARENT_GUID), dx: 7, dy: 3 },
    );

    expect(translated[0]).toMatchObject({ x: 17, y: 8, aabb: { x: 17, y: 8 } });
    expect(translated[1]).toMatchObject({ x: 27, y: 8, aabb: { x: 27, y: 8 } });
    expect(translated[2]).toBe(siblingBounds);
  });

  it("uses the Kiwi parent chain as the descendant source", () => {
    expect(figEditorSelectedNodeDragMovesBounds(
      nodesByGuid(),
      bounds(guidToString(CHILD_GUID), 0),
      guidToString(PARENT_GUID),
    )).toBe(true);
  });
});
