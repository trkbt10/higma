/**
 * @file Buzz editor workspace contract tests.
 */

import { createBuzzDocument } from "@higma-document-models/buzz";

import { createBuzzEditorWorkspace } from ".";

const summary: Parameters<typeof createBuzzDocument>[1] = {
  totalNodes: 6,
  nodeTypes: new Map([
    ["SLIDE_GRID", 1],
    ["SLIDE_ROW", 1],
    ["SYMBOL", 1],
    ["BOOLEAN_OPERATION", 1],
    ["VECTOR", 2],
  ]),
  topLevelFields: new Map([["type", 4]]),
};

const canvas: Parameters<typeof createBuzzDocument>[0] = {
  header: { magic: "fig-buzz", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [
    { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 }, name: "Document" },
    { type: "SLIDE_GRID", guid: { sessionID: 0, localID: 1 }, name: "Grid", parentIndex: { guid: { sessionID: 0, localID: 0 } } },
    { type: "SLIDE_ROW", guid: { sessionID: 0, localID: 2 }, name: "Row", parentIndex: { guid: { sessionID: 0, localID: 1 } } },
    { type: "SYMBOL", guid: { sessionID: 0, localID: 3 }, name: "Symbol", parentIndex: { guid: { sessionID: 0, localID: 2 } } },
    { type: "BOOLEAN_OPERATION", guid: { sessionID: 0, localID: 4 }, name: "Boolean", parentIndex: { guid: { sessionID: 0, localID: 3 } } },
    { type: "VECTOR", guid: { sessionID: 0, localID: 5 }, name: "Vector A", parentIndex: { guid: { sessionID: 0, localID: 4 } } },
    { type: "VECTOR", guid: { sessionID: 0, localID: 6 }, name: "Vector B", parentIndex: { guid: { sessionID: 0, localID: 4 } } },
  ],
  blobs: [],
  images: new Map(),
  metadata: null,
  thumbnail: null,
};

const insights: Parameters<typeof createBuzzDocument>[2] = {
  schema: {
    definitionCount: 5,
    definitionNames: ["Message", "NodeChange", "NodeType", "Paint", "VectorPath"],
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
    expect(workspace.renderPlan.domainSummary.templateNodeCount).toBe(6);
    expect(workspace.editableUnits.map((unit) => ({
      id: unit.id,
      role: unit.role,
      label: unit.label,
      templateScope: unit.templateScope,
      operationTarget: unit.operationTarget,
    }))).toEqual([
      { id: "0:1", role: "slide-grid", label: "Grid", templateScope: "slide-grid", operationTarget: "template-structure" },
      { id: "0:2", role: "slide-row", label: "Row", templateScope: "slide-row", operationTarget: "template-structure" },
      { id: "0:3", role: "symbol", label: "Symbol", templateScope: "symbol", operationTarget: "template-structure" },
      { id: "0:4", role: "boolean-operation", label: "Boolean", templateScope: "boolean-operation", operationTarget: "template-structure" },
      { id: "0:5", role: "vector", label: "Vector A", templateScope: "vector", operationTarget: "template-structure" },
      { id: "0:6", role: "vector", label: "Vector B", templateScope: "vector", operationTarget: "template-structure" },
    ]);
    expect(workspace.overview).toEqual({
      nodeCount: 6,
      renderUnitCount: 6,
      schemaDefinitionCount: 5,
      schemaDefinitionNames: ["Message", "NodeChange", "NodeType", "Paint", "VectorPath"],
      nodeTypeNames: ["BOOLEAN_OPERATION", "SLIDE_GRID", "SLIDE_ROW", "SYMBOL", "VECTOR"],
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["render_coordinates"],
      metadataFlags: {
        hasRenderCoordinates: true,
        hasThumbnailSize: false,
        hasDeveloperRelatedLinks: false,
        hasExportTimestamp: false,
      },
      domainSummary: {
        slideGridCount: 1,
        slideRowCount: 1,
        symbolCount: 1,
        vectorCount: 2,
        booleanOperationCount: 1,
        templateNodeCount: 6,
      },
    });
  });
});
