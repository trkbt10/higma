/**
 * @file Regression test for the resolveVisibleSelection crash on childless surfaces.
 */
// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { createSiteDocument } from "@higma-document-models/site";

import { createSiteEditorWorkspace } from "../site-editor-workspace";
import { SiteEditorProvider } from "./SiteEditorContext";

const summary: Parameters<typeof createSiteDocument>[1] = {
  totalNodes: 5,
  nodeTypes: new Map([
    ["CANVAS", 2],
    ["RESPONSIVE_SET", 1],
    ["SYMBOL", 2],
  ]),
  topLevelFields: new Map([["type", 5]]),
};

const insights: Parameters<typeof createSiteDocument>[2] = {
  schema: {
    definitionCount: 0,
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

function createChildlessSurfaceDocument() {
  return createSiteDocument({
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
        type: "SYMBOL",
        guid: { sessionID: 0, localID: 22 },
        name: "Breakpoint=Mobile",
        parentIndex: { guid: { sessionID: 0, localID: 20 } },
        transform: { m00: 1, m01: 0, m02: 760, m10: 0, m11: 1, m12: -120 },
        size: { x: 390, y: 1 },
      },
      // Responsive-set surface whose only child render units are the variant
      // FRAMEs themselves; no editable layout descendants live inside them.
      {
        type: "RESPONSIVE_SET",
        guid: { sessionID: 0, localID: 1 },
        name: "Lonely Page",
        parentIndex: { guid: { sessionID: 0, localID: 10 } },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        size: { x: 720, y: 480 },
      },
      {
        type: "FRAME",
        guid: { sessionID: 0, localID: 11 },
        name: "Desktop",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        size: { x: 720, y: 480 },
      },
      {
        type: "FRAME",
        guid: { sessionID: 0, localID: 12 },
        name: "Mobile",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 760, m10: 0, m11: 1, m12: 0 },
        size: { x: 390, y: 480 },
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
  }, summary, insights);
}

describe("SiteEditorProvider", () => {
  it("does not throw when the active surface has no editable children for the active breakpoint", () => {
    const workspace = createSiteEditorWorkspace(createChildlessSurfaceDocument());
    expect(() => {
      render(
        <SiteEditorProvider workspace={workspace}>
          <div />
        </SiteEditorProvider>,
      );
    }).not.toThrow();
  });
});
