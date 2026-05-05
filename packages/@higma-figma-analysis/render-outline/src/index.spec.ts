/**
 * @file Product-free render outline tests.
 */

import { createFigmaRenderOutline } from ".";

const roles = [
  { nodeType: "SLIDE_GRID", role: "grid" },
  { nodeType: "SLIDE", role: "slide" },
] as const;

function node(
  type: string,
  sessionID: number,
  localID: number,
  parent?: { readonly sessionID: number; readonly localID: number },
): Record<string, unknown> {
  return {
    type: { name: type },
    guid: { sessionID, localID },
    name: `${type} ${localID}`,
    parentIndex: parent ? { guid: parent, position: "!" } : undefined,
  };
}

describe("createFigmaRenderOutline", () => {
  it("extracts explicitly selected render outline roles with parent depth", () => {
    const outline = createFigmaRenderOutline([
      node("DOCUMENT", 0, 0),
      node("SLIDE_GRID", 0, 1, { sessionID: 0, localID: 0 }),
      node("FRAME", 0, 2, { sessionID: 0, localID: 1 }),
      node("SLIDE", 0, 3, { sessionID: 0, localID: 1 }),
    ], roles);

    expect(outline.entries).toEqual([
      {
        id: "0:1",
        type: "SLIDE_GRID",
        role: "grid",
        name: "SLIDE_GRID 1",
        parentId: "0:0",
        childIds: ["0:2", "0:3"],
        depth: 1,
        order: 1,
      },
      {
        id: "0:3",
        type: "SLIDE",
        role: "slide",
        name: "SLIDE 3",
        parentId: "0:1",
        childIds: [],
        depth: 2,
        order: 3,
      },
    ]);
  });

  it("throws when a selected render node has no guid", () => {
    expect(() => createFigmaRenderOutline([{ type: "SLIDE" }], roles)).toThrow(
      "Selected fig-family render outline node SLIDE is missing guid",
    );
  });

  it("throws when a parent guid is not present in decoded node changes", () => {
    expect(() => createFigmaRenderOutline([
      node("SLIDE", 0, 1, { sessionID: 9, localID: 9 }),
    ], roles)).toThrow("Invalid fig-family render outline parent guid 9:9");
  });
});
