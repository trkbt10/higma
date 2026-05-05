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
  nodeChanges: [],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createSiteDocument>[2] = {
  schema: {
    definitionCount: 7,
    definitionNames: [],
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
      schemaDefinitionCount: 7,
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["background_color"],
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
