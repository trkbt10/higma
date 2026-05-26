/** @file Kiwi document index tests. */

import type { FigGuid, FigNode } from "../types";
import { NODE_TYPE_VALUES } from "../constants";
import { indexFigKiwiDocument } from "./kiwi-document-index";

type IndexedNodeType = "DOCUMENT" | "CANVAS" | "RECTANGLE";

function guid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function node(name: IndexedNodeType, id: FigGuid): FigNode {
  return {
    guid: id,
    phase: { value: 0, name: "CREATED" },
    type: { value: NODE_TYPE_VALUES[name], name },
  };
}

describe("indexFigKiwiDocument", () => {
  it("indexes Kiwi nodeChanges positions by FigGuid key", () => {
    const document = indexFigKiwiDocument([
      node("DOCUMENT", guid(0, 1)),
      node("CANVAS", guid(1, 2)),
      node("RECTANGLE", guid(1, 3)),
    ]);

    expect(document.nodeIndexByGuid.get("0:1")).toBe(0);
    expect(document.nodeIndexByGuid.get("1:2")).toBe(1);
    expect(document.nodeIndexByGuid.get("1:3")).toBe(2);
  });
});
