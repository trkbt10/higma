/**
 * @file Deck editor workspace contract tests.
 */

import { createDeckDocument } from "@higma-document-models/deck";

import { createDeckEditorWorkspace } from ".";

const summary: Parameters<typeof createDeckDocument>[1] = {
  totalNodes: 2,
  nodeTypes: new Map([["SLIDE", 1]]),
  topLevelFields: new Map([["type", 2]]),
};

const canvas: Parameters<typeof createDeckDocument>[0] = {
  header: { magic: "fig-deck", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createDeckDocument>[2] = {
  schema: {
    definitionCount: 3,
    definitionNames: [],
    messageFields: [],
    nodeChangeFields: [],
    nodeTypeEnumValues: [],
  },
  metadata: {
    rawKeys: ["client_meta"],
    clientMetaKeys: ["thumbnail_size"],
    hasRenderCoordinates: false,
    hasThumbnailSize: true,
    hasDeveloperRelatedLinks: false,
    hasExportTimestamp: false,
  },
  nodeSummary: summary,
};

describe("createDeckEditorWorkspace", () => {
  it("carries document insights into session, render plan, and editor overview", () => {
    const document = createDeckDocument(canvas, summary, insights);
    const workspace = createDeckEditorWorkspace(document);

    expect(workspace.session.insights).toBe(insights);
    expect(workspace.renderPlan.insights).toBe(insights);
    expect(workspace.overview).toEqual({
      nodeCount: 2,
      schemaDefinitionCount: 3,
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["thumbnail_size"],
    });
  });
});
