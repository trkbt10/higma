/**
 * @file Site editor workspace contract tests.
 */

import { createSiteDocument } from "@higma-document-models/site";

import { createSiteEditorWorkspace } from ".";

const summary: Parameters<typeof createSiteDocument>[1] = {
  totalNodes: 10,
  nodeTypes: new Map([
    ["CANVAS", 2],
    ["CMS_RICH_TEXT", 1],
    ["REPEATER", 1],
    ["RESPONSIVE_SET", 2],
    ["SYMBOL", 2],
    ["INSTANCE", 1],
  ]),
  topLevelFields: new Map([["type", 10]]),
};

const canvas: Parameters<typeof createSiteDocument>[0] = {
  header: { magic: "fig-site", version: "0", payloadSize: 0 },
  schema: { definitions: [] },
  message: {},
  nodeChanges: [
    { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 }, name: "Document" },
    {
      type: "CANVAS",
      guid: { sessionID: 0, localID: 10 },
      name: "Page",
      parentIndex: { guid: { sessionID: 0, localID: 0 } },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    {
      type: "CANVAS",
      guid: { sessionID: 0, localID: 20 },
      name: "Internal Only Canvas",
      parentIndex: { guid: { sessionID: 0, localID: 0 } },
      internalOnly: true,
      visible: false,
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    {
      type: "SYMBOL",
      guid: { sessionID: 0, localID: 21 },
      name: "Breakpoint=Desktop",
      parentIndex: { guid: { sessionID: 0, localID: 20 } },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: -120 },
      size: { x: 720, y: 1 },
    },
    {
      type: "CMS_RICH_TEXT",
      guid: { sessionID: 0, localID: 1 },
      name: "Body",
      parentIndex: { guid: { sessionID: 0, localID: 10 } },
      transform: { m00: 1, m01: 0, m02: 8, m10: 0, m11: 1, m12: 12 },
      size: { x: 100, y: 40 },
    },
    {
      type: "REPEATER",
      guid: { sessionID: 0, localID: 2 },
      name: "Cards",
      parentIndex: { guid: { sessionID: 0, localID: 10 } },
      transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 24 },
      size: { x: 300, y: 200 },
    },
    {
      type: "RESPONSIVE_SET",
      guid: { sessionID: 0, localID: 3 },
      name: "Desktop",
      parentIndex: { guid: { sessionID: 0, localID: 2 } },
      transform: { m00: 1, m01: 0, m02: 32, m10: 0, m11: 1, m12: 48 },
      size: { x: 180, y: 120 },
    },
    {
      type: "RESPONSIVE_SET",
      guid: { sessionID: 0, localID: 4 },
      name: "Mobile",
      parentIndex: { guid: { sessionID: 0, localID: 2 } },
      transform: { m00: 1, m01: 0, m02: 64, m10: 0, m11: 1, m12: 96 },
      size: { x: 120, y: 180 },
    },
    {
      type: "SYMBOL",
      guid: { sessionID: 0, localID: 5 },
      name: "Card",
      parentIndex: { guid: { sessionID: 0, localID: 3 } },
      transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
      size: { x: 80, y: 60 },
    },
    {
      type: "INSTANCE",
      guid: { sessionID: 0, localID: 6 },
      name: "Card Instance",
      parentIndex: { guid: { sessionID: 0, localID: 5 } },
      transform: { m00: 1, m01: 0, m02: 4, m10: 0, m11: 1, m12: 6 },
      size: { x: 72, y: 48 },
    },
  ],
  blobs: [],
  images: new Map(),
  metadata: {
    raw: { client_meta: { render_coordinates: { x: 0, y: -180, width: 840, height: 760 } } },
    rawKeys: ["client_meta"],
    clientMeta: { renderCoordinates: { x: 0, y: -180, width: 840, height: 760 } },
  },
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
    clientMetaKeys: ["render_coordinates"],
    hasRenderCoordinates: true,
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
    expect(workspace.renderPlan.domainSummary.layoutNodeCount).toBe(7);
    expect(workspace.renderPlan.viewport).toEqual({ x: 0, y: -180, width: 840, height: 760 });
    expect(workspace.breakpoints).toEqual([
      {
        kind: "site-breakpoint",
        id: "0:21",
        name: "Desktop",
        bounds: { x: 0, y: -120, width: 720, height: 1 },
      },
    ]);
    expect(workspace.editableUnits.map((unit) => ({
      id: unit.id,
      role: unit.role,
      label: unit.label,
      layoutScope: unit.layoutScope,
      responsiveSetId: unit.responsiveSetId,
      responsiveBreakpointName: unit.responsiveBreakpointName,
      operationTarget: unit.operationTarget,
    }))).toEqual([
      { id: "0:1", role: "cms-rich-text", label: "Body", layoutScope: "cms-rich-text", responsiveSetId: null, responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
      { id: "0:2", role: "repeater", label: "Cards", layoutScope: "repeater", responsiveSetId: null, responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
      { id: "0:3", role: "responsive-set", label: "Desktop", layoutScope: "responsive-set", responsiveSetId: "0:3", responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
      { id: "0:4", role: "responsive-set", label: "Mobile", layoutScope: "responsive-set", responsiveSetId: "0:4", responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
      { id: "0:5", role: "symbol", label: "Card", layoutScope: "symbol", responsiveSetId: "0:3", responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
      { id: "0:6", role: "instance", label: "Card Instance", layoutScope: "instance", responsiveSetId: "0:3", responsiveBreakpointName: null, operationTarget: "site-layout-structure" },
    ]);
    expect(workspace.overview).toEqual({
      nodeCount: 10,
      renderUnitCount: 7,
      schemaDefinitionCount: 7,
      schemaDefinitionNames: ["Message", "NodeChange", "NodeType", "CmsRichText", "Repeater", "ResponsiveSet", "Symbol"],
      nodeTypeNames: ["CANVAS", "CMS_RICH_TEXT", "INSTANCE", "REPEATER", "RESPONSIVE_SET", "SYMBOL"],
      metadataKeys: ["client_meta"],
      clientMetaKeys: ["render_coordinates"],
      metadataFlags: {
        hasRenderCoordinates: true,
        hasThumbnailSize: false,
        hasDeveloperRelatedLinks: false,
        hasExportTimestamp: false,
      },
      domainSummary: {
        cmsRichTextCount: 1,
        repeaterCount: 1,
        responsiveSetCount: 2,
        symbolCount: 2,
        instanceCount: 1,
        layoutNodeCount: 7,
      },
    });
  });
});
