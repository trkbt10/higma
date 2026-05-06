/**
 * @file Deck editor workspace contract tests.
 */

import { createDeckDocument } from "@higma-document-models/deck";

import { createDeckEditorWorkspace } from ".";

const summary: Parameters<typeof createDeckDocument>[1] = {
  totalNodes: 4,
  nodeTypes: new Map([
    ["SLIDE_GRID", 1],
    ["SLIDE_ROW", 1],
    ["SLIDE", 1],
    ["INTERACTIVE_SLIDE_ELEMENT", 1],
  ]),
  topLevelFields: new Map([["type", 4]]),
};

const canvas: Parameters<typeof createDeckDocument>[0] = {
  header: { magic: "fig-deck", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [
    { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 }, name: "Document" },
    { type: "SLIDE_GRID", guid: { sessionID: 0, localID: 1 }, name: "Grid", parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    { type: "SLIDE_ROW", guid: { sessionID: 0, localID: 2 }, name: "Row", parentIndex: { guid: { sessionID: 0, localID: 1 } } },
    { type: "SLIDE", guid: { sessionID: 0, localID: 3 }, name: "Slide", parentIndex: { guid: { sessionID: 0, localID: 2 } } },
    {
      type: "INTERACTIVE_SLIDE_ELEMENT",
      guid: { sessionID: 0, localID: 4 },
      name: "Button",
      parentIndex: { guid: { sessionID: 0, localID: 3 } },
    },
  ],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createDeckDocument>[2] = {
  schema: {
    definitionCount: 3,
    definitionNames: ["Message", "NodeChange", "NodeType"],
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
    expect(workspace.renderPlan.domainSummary.presentationNodeCount).toBe(4);
    expect(workspace.editableUnits.map((unit) => ({
      id: unit.id,
      role: unit.role,
      label: unit.label,
      presentationScope: unit.presentationScope,
      operationTarget: unit.operationTarget,
    }))).toEqual([
      { id: "0:1", role: "slide-grid", label: "Grid", presentationScope: "slide-grid", operationTarget: "presentation-structure" },
      { id: "0:2", role: "slide-row", label: "Row", presentationScope: "slide-row", operationTarget: "presentation-structure" },
      { id: "0:3", role: "slide", label: "Slide", presentationScope: "slide", operationTarget: "presentation-structure" },
      {
        id: "0:4",
        role: "interactive-slide-element",
        label: "Button",
        presentationScope: "interactive-slide-element",
        operationTarget: "presentation-structure",
      },
    ]);
    expect(workspace.overview).toEqual({
      nodeCount: 4,
      renderUnitCount: 4,
      schemaDefinitionCount: 3,
      schemaDefinitionNames: ["Message", "NodeChange", "NodeType"],
      nodeTypeNames: ["INTERACTIVE_SLIDE_ELEMENT", "SLIDE", "SLIDE_GRID", "SLIDE_ROW"],
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["thumbnail_size"],
      metadataFlags: {
        hasRenderCoordinates: false,
        hasThumbnailSize: true,
        hasDeveloperRelatedLinks: false,
        hasExportTimestamp: false,
      },
      domainSummary: {
        slideGridCount: 1,
        slideRowCount: 1,
        slideCount: 1,
        interactiveElementCount: 1,
        presentationNodeCount: 4,
      },
    });
  });
});
