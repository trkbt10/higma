/**
 * @file Site editor workspace contract tests.
 */

import { createSiteDocument } from "@higma-document-models/site";

import { createSiteEditorWorkspace } from ".";

const summary: Parameters<typeof createSiteDocument>[1] = {
  totalNodes: 6,
  nodeTypes: new Map([
    ["CMS_RICH_TEXT", 1],
    ["REPEATER", 1],
    ["RESPONSIVE_SET", 2],
    ["SYMBOL", 1],
    ["INSTANCE", 1],
  ]),
  topLevelFields: new Map([["type", 6]]),
};

const canvas: Parameters<typeof createSiteDocument>[0] = {
  header: { magic: "fig-site", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [
    { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 }, name: "Document" },
    { type: "CMS_RICH_TEXT", guid: { sessionID: 0, localID: 1 }, parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    { type: "REPEATER", guid: { sessionID: 0, localID: 2 }, parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    { type: "RESPONSIVE_SET", guid: { sessionID: 0, localID: 3 }, parentIndex: { guid: { sessionID: 0, localID: 2 } } },
    { type: "RESPONSIVE_SET", guid: { sessionID: 0, localID: 4 }, parentIndex: { guid: { sessionID: 0, localID: 2 } } },
    { type: "SYMBOL", guid: { sessionID: 0, localID: 5 }, parentIndex: { guid: { sessionID: 0, localID: 3 } } },
    { type: "INSTANCE", guid: { sessionID: 0, localID: 6 }, parentIndex: { guid: { sessionID: 0, localID: 5 } } },
  ],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createSiteDocument>[2] = {
  schema: {
    definitionCount: 7,
    definitionNames: ["Message", "NodeChange", "NodeType", "CmsRichText", "Repeater", "ResponsiveSet", "Symbol"],
    messageFields: [],
    nodeChangeFields: [],
    nodeTypeEnumValues: [],
  },
  metadata: {
    rawKeys: ["client_meta"],
    clientMetaKeys: ["background_color"],
    hasRenderCoordinates: false,
    hasThumbnailSize: false,
    hasDeveloperRelatedLinks: false,
    hasExportTimestamp: false,
  },
  nodeSummary: summary,
};

describe("createSiteEditorWorkspace", () => {
  it("carries document insights into session, render plan, and editor overview", () => {
    const document = createSiteDocument(canvas, summary, insights);
    const workspace = createSiteEditorWorkspace(document);

    expect(workspace.session.insights).toBe(insights);
    expect(workspace.renderPlan.insights).toBe(insights);
    expect(workspace.renderPlan.domainSummary.layoutNodeCount).toBe(6);
    expect(workspace.overview).toEqual({
      nodeCount: 6,
      renderUnitCount: 6,
      schemaDefinitionCount: 7,
      schemaDefinitionNames: ["Message", "NodeChange", "NodeType", "CmsRichText", "Repeater", "ResponsiveSet", "Symbol"],
      nodeTypeNames: ["CMS_RICH_TEXT", "INSTANCE", "REPEATER", "RESPONSIVE_SET", "SYMBOL"],
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["background_color"],
      metadataFlags: {
        hasRenderCoordinates: false,
        hasThumbnailSize: false,
        hasDeveloperRelatedLinks: false,
        hasExportTimestamp: false,
      },
      domainSummary: {
        cmsRichTextCount: 1,
        repeaterCount: 1,
        responsiveSetCount: 2,
        symbolCount: 1,
        instanceCount: 1,
        layoutNodeCount: 6,
      },
    });
  });
});
