/**
 * @file Deck render plan tests.
 */

import { createDeckDocument } from "@higma-document-models/deck";

import { createDeckRenderPlan } from ".";

const insights: Parameters<typeof createDeckDocument>[2] = {
  schema: {
    definitionCount: 1,
    definitionNames: ["Message"],
    messageFields: [],
    nodeChangeFields: [],
    nodeTypeEnumValues: [],
  },
  metadata: {
    rawKeys: [],
    clientMetaKeys: [],
    hasRenderCoordinates: false,
    hasThumbnailSize: false,
    hasDeveloperRelatedLinks: false,
    hasExportTimestamp: false,
  },
  nodeSummary: {
    totalNodes: 1,
    nodeTypes: new Map([["SLIDE", 1]]),
    topLevelFields: new Map(),
  },
};

function createDocument(nodeChanges: readonly unknown[]) {
  return createDeckDocument({
    header: { magic: "fig-deck", version: "0", payloadSize: 0 },
    schema: { definitions: [] },
    message: {},
    nodeChanges,
    blobs: [],
    images: new Map(),
    metadata: null,
    thumbnail: null,
  }, insights.nodeSummary, insights);
}

describe("createDeckRenderPlan", () => {
  it("creates explicit presentation render units", () => {
    const plan = createDeckRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      { type: "SLIDE", guid: { sessionID: 0, localID: 1 }, name: "Launch", parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    ]));

    expect(plan.renderOutline.entries).toHaveLength(1);
    expect(plan.renderOutline.entries[0]!.role).toBe("slide");
    expect(plan.renderUnits).toEqual([
      {
        kind: "deck-render-unit",
        id: "0:1",
        role: "slide",
        nodeType: "SLIDE",
        label: "Launch",
        parentId: "0:0",
        childIds: [],
        depth: 1,
        order: 1,
        presentationScope: "slide",
      },
    ]);
  });

  it("throws when no presentation render units exist", () => {
    expect(() => createDeckRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
    ]))).toThrow("Deck render plan requires at least one presentation render unit");
  });
});
