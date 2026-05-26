/** @file Rendered SceneGraph node bounds hit-test tests. */

import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import {
  collectExplicitKiwiSourceDocumentGuidKeys,
  containsPointInBounds,
  filterRenderedNodeBoundsToPrimaryKiwiDocument,
  filterMarqueeSelectionByHierarchy,
} from "./rendered-node-bounds";

function guid(localID: number): FigGuid {
  return { sessionID: 70, localID };
}

function figNode(localID: number, parent: FigGuid | undefined = undefined): FigNode {
  return {
    guid: guid(localID),
    phase: { value: 0, name: "PAINT" },
    type: { value: NODE_TYPE_VALUES.RECTANGLE, name: "RECTANGLE" },
    name: `RECTANGLE-${localID}`,
    parentIndex: parent === undefined ? undefined : { guid: parent, position: `${localID}` },
    visible: true,
  };
}

describe("containsPointInBounds", () => {
  it("accepts points inside and on the edge", () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };

    expect(containsPointInBounds(bounds, { x: 10, y: 20 })).toBe(true);
    expect(containsPointInBounds(bounds, { x: 25, y: 35 })).toBe(true);
    expect(containsPointInBounds(bounds, { x: 40, y: 60 })).toBe(true);
  });

  it("rejects points outside", () => {
    const bounds = { x: 10, y: 20, width: 30, height: 40 };

    expect(containsPointInBounds(bounds, { x: 9.9, y: 20 })).toBe(false);
    expect(containsPointInBounds(bounds, { x: 10, y: 60.1 })).toBe(false);
  });
});

describe("filterMarqueeSelectionByHierarchy", () => {
  it("removes selected ancestors when a descendant is also selected", () => {
    const parent = figNode(1);
    const child = figNode(2, parent.guid);
    const document = indexFigKiwiDocument([parent, child]);

    expect(filterMarqueeSelectionByHierarchy(document, ["70:1", "70:2"])).toEqual(["70:2"]);
    expect(filterMarqueeSelectionByHierarchy(document, ["70:1"])).toEqual(["70:1"]);
  });
});

describe("filterRenderedNodeBoundsToPrimaryKiwiDocument", () => {
  it("keeps primary Kiwi document bounds and excludes explicit source document bounds", () => {
    const primary = figNode(1);
    const source = figNode(2);
    const document = indexFigKiwiDocument([primary]);
    const explicitSourceGuidKeys = collectExplicitKiwiSourceDocumentGuidKeys([{ nodeChanges: [source] }]);
    const bounds = [
      { id: "70:1", x: 0, y: 0, width: 10, height: 10 },
      { id: "70:2", x: 20, y: 0, width: 10, height: 10 },
    ];

    expect(filterRenderedNodeBoundsToPrimaryKiwiDocument({
      document,
      explicitSourceGuidKeys,
      bounds,
      owner: "rendered-node-bounds.spec",
    })).toEqual([{ id: "70:1", x: 0, y: 0, width: 10, height: 10 }]);
  });

  it("fails when renderer emits a bounds id from no Kiwi document source", () => {
    const document = indexFigKiwiDocument([figNode(1)]);
    const explicitSourceGuidKeys = collectExplicitKiwiSourceDocumentGuidKeys([]);

    expect(() => filterRenderedNodeBoundsToPrimaryKiwiDocument({
      document,
      explicitSourceGuidKeys,
      bounds: [{ id: "70:99", x: 0, y: 0, width: 10, height: 10 }],
      owner: "rendered-node-bounds.spec",
    })).toThrow("rendered-node-bounds.spec: rendered node 70:99 is not present in the primary Kiwi document or explicit Kiwi source documents");
  });
});
