/**
 * @file Buzz render plan tests.
 */

import { createBuzzDocument } from "@higma-document-models/buzz";

import { createBuzzRenderPlan } from ".";

const insights: Parameters<typeof createBuzzDocument>[2] = {
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
    nodeTypes: new Map([["SYMBOL", 1]]),
    topLevelFields: new Map(),
  },
};

function createDocument(nodeChanges: readonly unknown[]) {
  return createBuzzDocument({
    header: { magic: "fig-buzz", version: "0", payloadSize: 0 },
    schema: { definitions: [] },
    message: {},
    nodeChanges,
    blobs: [],
    images: new Map(),
    metadata: null,
    thumbnail: null,
  }, insights.nodeSummary, insights);
}

describe("createBuzzRenderPlan", () => {
  it("creates explicit template render units", () => {
    const plan = createBuzzRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      { type: "SYMBOL", guid: { sessionID: 0, localID: 1 }, parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    ]));

    expect(plan.renderOutline.entries).toHaveLength(1);
    expect(plan.renderOutline.entries[0]!.role).toBe("symbol");
  });

  it("throws when no template render units exist", () => {
    expect(() => createBuzzRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
    ]))).toThrow("Buzz render plan requires at least one template render unit");
  });
});
