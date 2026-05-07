/**
 * @file Site editor test fixture.
 */

import { createSiteDocument } from "@higma-document-models/site";
import type { SiteDocument } from "@higma-document-models/site";

const summary: Parameters<typeof createSiteDocument>[1] = {
  totalNodes: 17,
  nodeTypes: new Map([
    ["CANVAS", 2],
    ["RESPONSIVE_SET", 1],
    ["REPEATER", 3],
    ["CMS_RICH_TEXT", 3],
    ["RECTANGLE", 1],
    ["SYMBOL", 3],
    ["FRAME", 3],
  ]),
  topLevelFields: new Map([["type", 17]]),
};

const insights: Parameters<typeof createSiteDocument>[2] = {
  schema: {
    definitionCount: 1,
    definitionNames: ["Message"],
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

/** Create a site document with layout structure and CMS bindings for editor tests. */
export function createSiteEditorTestDocument(): SiteDocument {
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
        name: "Breakpoint=Tablet",
        parentIndex: { guid: { sessionID: 0, localID: 20 } },
        transform: { m00: 1, m01: 0, m02: 760, m10: 0, m11: 1, m12: -120 },
        size: { x: 640, y: 1 },
      },
      {
        type: "SYMBOL",
        guid: { sessionID: 0, localID: 23 },
        name: "Breakpoint=Mobile",
        parentIndex: { guid: { sessionID: 0, localID: 20 } },
        transform: { m00: 1, m01: 0, m02: 1440, m10: 0, m11: 1, m12: -120 },
        size: { x: 390, y: 1 },
      },
      {
        type: "RESPONSIVE_SET",
        guid: { sessionID: 0, localID: 1 },
        name: "Case Study Page",
        parentIndex: { guid: { sessionID: 0, localID: 10 } },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        size: { x: 720, y: 480 },
        cmsSelector: {
          cmsCollectionId: "collection-1",
          filterCriteria: {
            matchType: { name: "MATCH_ALL" },
            filters: [{ cmsFieldId: "slug", op: { name: "EQUALS" }, comparisonValue: "case-study" }],
          },
          sorts: [],
          limit: 1,
        },
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
        name: "Tablet",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 760, m10: 0, m11: 1, m12: 0 },
        size: { x: 640, y: 480 },
      },
      {
        type: "FRAME",
        guid: { sessionID: 0, localID: 13 },
        name: "Mobile",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 1440, m10: 0, m11: 1, m12: 0 },
        size: { x: 390, y: 480 },
      },
      {
        type: "RECTANGLE",
        guid: { sessionID: 0, localID: 4 },
        name: "Hero Background",
        parentIndex: { guid: { sessionID: 0, localID: 11 } },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 24 },
        size: { x: 420, y: 180 },
        fillPaints: [
          {
            type: "SOLID",
            visible: true,
            opacity: 1,
            color: { r: 0.92, g: 0.96, b: 1, a: 1 },
          },
        ],
      },
      {
        type: "REPEATER",
        guid: { sessionID: 0, localID: 2 },
        name: "Articles",
        parentIndex: { guid: { sessionID: 0, localID: 11 } },
        transform: { m00: 1, m01: 0, m02: 48, m10: 0, m11: 1, m12: 96 },
        size: { x: 320, y: 240 },
        cmsSelector: {
          cmsCollectionId: "collection-1",
          filterCriteria: { matchType: { name: "MATCH_ALL" }, filters: [] },
          sorts: [],
          limit: 0,
        },
      },
      {
        type: "CMS_RICH_TEXT",
        guid: { sessionID: 0, localID: 3 },
        name: "Body",
        parentIndex: { guid: { sessionID: 0, localID: 2 } },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 32 },
        size: { x: 180, y: 96 },
        cmsRichTextStyleMap: { entries: [{ styleClass: { name: "PARAGRAPH" } }] },
        parameterConsumptionMap: {
          entries: [
            {
              variableData: {
                value: { cmsAliasValue: { collectionId: "collection-1", itemId: "", fieldId: "body" } },
                dataType: { name: "CMS_ALIAS" },
                resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
              },
              variableField: { name: "CMS_SERIALIZED_RICH_TEXT_DATA" },
            },
          ],
        },
        variableConsumptionMap: { entries: [] },
      },
      {
        type: "REPEATER",
        guid: { sessionID: 0, localID: 5 },
        name: "Tablet Articles",
        parentIndex: { guid: { sessionID: 0, localID: 12 } },
        transform: { m00: 1, m01: 0, m02: 40, m10: 0, m11: 1, m12: 104 },
        size: { x: 300, y: 216 },
        cmsSelector: {
          cmsCollectionId: "collection-1",
          filterCriteria: { matchType: { name: "MATCH_ALL" }, filters: [] },
          sorts: [],
          limit: 0,
        },
      },
      {
        type: "CMS_RICH_TEXT",
        guid: { sessionID: 0, localID: 6 },
        name: "Tablet Body",
        parentIndex: { guid: { sessionID: 0, localID: 5 } },
        transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 28 },
        size: { x: 168, y: 88 },
        cmsRichTextStyleMap: { entries: [{ styleClass: { name: "PARAGRAPH" } }] },
        parameterConsumptionMap: {
          entries: [
            {
              variableData: {
                value: { cmsAliasValue: { collectionId: "collection-1", itemId: "", fieldId: "body" } },
                dataType: { name: "CMS_ALIAS" },
                resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
              },
              variableField: { name: "CMS_SERIALIZED_RICH_TEXT_DATA" },
            },
          ],
        },
        variableConsumptionMap: { entries: [] },
      },
      {
        type: "REPEATER",
        guid: { sessionID: 0, localID: 7 },
        name: "Mobile Articles",
        parentIndex: { guid: { sessionID: 0, localID: 13 } },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 88 },
        size: { x: 260, y: 196 },
        cmsSelector: {
          cmsCollectionId: "collection-1",
          filterCriteria: { matchType: { name: "MATCH_ALL" }, filters: [] },
          sorts: [],
          limit: 0,
        },
      },
      {
        type: "CMS_RICH_TEXT",
        guid: { sessionID: 0, localID: 8 },
        name: "Mobile Body",
        parentIndex: { guid: { sessionID: 0, localID: 7 } },
        transform: { m00: 1, m01: 0, m02: 16, m10: 0, m11: 1, m12: 24 },
        size: { x: 150, y: 80 },
        cmsRichTextStyleMap: { entries: [{ styleClass: { name: "PARAGRAPH" } }] },
        parameterConsumptionMap: {
          entries: [
            {
              variableData: {
                value: { cmsAliasValue: { collectionId: "collection-1", itemId: "", fieldId: "body" } },
                dataType: { name: "CMS_ALIAS" },
                resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
              },
              variableField: { name: "CMS_SERIALIZED_RICH_TEXT_DATA" },
            },
          ],
        },
        variableConsumptionMap: { entries: [] },
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
