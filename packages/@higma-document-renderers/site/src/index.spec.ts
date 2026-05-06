/**
 * @file Site render plan tests.
 */

import { createSiteDocument } from "@higma-document-models/site";

import { createSiteRenderPlan } from ".";

const insights: Parameters<typeof createSiteDocument>[2] = {
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
    nodeTypes: new Map([["RESPONSIVE_SET", 1]]),
    topLevelFields: new Map(),
  },
};

function createDocument(nodeChanges: readonly unknown[]) {
  return createSiteDocument({
    header: { magic: "fig-site", version: "0", payloadSize: 0 },
    schema: { definitions: [] },
    message: {},
    nodeChanges,
    blobs: [],
    images: new Map(),
    metadata: null,
    thumbnail: null,
  }, insights.nodeSummary, insights);
}

describe("createSiteRenderPlan", () => {
  it("creates explicit layout render units", () => {
    const plan = createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      { type: "RESPONSIVE_SET", guid: { sessionID: 0, localID: 1 }, name: "Hero Breakpoints", parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    ]));

    expect(plan.renderOutline.entries).toHaveLength(1);
    expect(plan.renderOutline.entries[0]!.role).toBe("responsive-set");
    expect(plan.renderUnits).toEqual([
      {
        kind: "site-render-unit",
        id: "0:1",
        role: "responsive-set",
        nodeType: "RESPONSIVE_SET",
        label: "Hero Breakpoints",
        parentId: "0:0",
        childIds: [],
        depth: 1,
        order: 1,
        layoutScope: "responsive-set",
      },
    ]);
  });

  it("throws when no layout render units exist", () => {
    expect(() => createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
    ]))).toThrow("Site render plan requires at least one layout render unit");
  });
});
