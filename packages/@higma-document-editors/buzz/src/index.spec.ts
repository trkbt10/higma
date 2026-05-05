/**
 * @file Buzz editor workspace contract tests.
 */

import { createBuzzDocument } from "@higma-document-models/buzz";

import { createBuzzEditorWorkspace } from ".";

const summary: Parameters<typeof createBuzzDocument>[1] = {
  totalNodes: 4,
  nodeTypes: new Map([["VECTOR", 4]]),
  topLevelFields: new Map([["type", 4]]),
};

const canvas: Parameters<typeof createBuzzDocument>[0] = {
  header: { magic: "fig-buzz", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createBuzzDocument>[2] = {
  schema: {
    definitionCount: 5,
    definitionNames: [],
    messageFields: [],
    nodeChangeFields: [],
    nodeTypeEnumValues: [],
  },
  metadata: {
    rawKeys: ["client_meta"],
    clientMetaKeys: ["render_coordinates"],
    hasRenderCoordinates: true,
    hasThumbnailSize: false,
    hasDeveloperRelatedLinks: false,
    hasExportTimestamp: false,
  },
  nodeSummary: summary,
};

describe("createBuzzEditorWorkspace", () => {
  it("carries document insights into session, render plan, and editor overview", () => {
    const document = createBuzzDocument(canvas, summary, insights);
    const workspace = createBuzzEditorWorkspace(document);

    expect(workspace.session.insights).toBe(insights);
    expect(workspace.renderPlan.insights).toBe(insights);
    expect(workspace.overview).toEqual({
      nodeCount: 4,
      schemaDefinitionCount: 5,
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["render_coordinates"],
    });
  });
});
