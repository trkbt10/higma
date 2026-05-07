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
    rawKeys: ["client_meta"],
    clientMetaKeys: ["render_coordinates"],
    hasRenderCoordinates: true,
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
    metadata: {
      raw: { client_meta: { render_coordinates: { x: -100, y: -80, width: 900, height: 640 } } },
      rawKeys: ["client_meta"],
      clientMeta: { renderCoordinates: { x: -100, y: -80, width: 900, height: 640 } },
    },
    thumbnail: null,
  }, insights.nodeSummary, insights);
}

describe("createSiteRenderPlan", () => {
  it("creates explicit layout render units", () => {
    const plan = createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      {
        type: "RESPONSIVE_SET",
        guid: { sessionID: 0, localID: 1 },
        name: "Hero Breakpoints",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
        transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
        size: { x: 300, y: 200 },
      },
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
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        responsiveSetId: "0:1",
        responsiveBreakpointName: null,
        layoutScope: "responsive-set",
      },
    ]);
    expect(plan.cmsBindings).toEqual([]);
    expect(plan.viewport).toEqual({ x: -100, y: -80, width: 900, height: 640 });
    expect(plan.surfaces).toEqual([]);
  });

  it("extracts site breakpoint symbols separately from render units", () => {
    const plan = createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      {
        type: "CANVAS",
        guid: { sessionID: 0, localID: 10 },
        name: "Internal Only Canvas",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
        internalOnly: true,
        visible: false,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      {
        type: "SYMBOL",
        guid: { sessionID: 0, localID: 1 },
        name: "Breakpoint=Desktop",
        parentIndex: { guid: { sessionID: 0, localID: 10 } },
        transform: { m00: 1, m01: 0, m02: 120, m10: 0, m11: 1, m12: -240 },
        size: { x: 1200, y: 1 },
      },
      {
        type: "SYMBOL",
        guid: { sessionID: 0, localID: 2 },
        name: "Breakpoint=Mobile",
        parentIndex: { guid: { sessionID: 0, localID: 10 } },
        transform: { m00: 1, m01: 0, m02: 560, m10: 0, m11: 1, m12: -240 },
        size: { x: 390, y: 1 },
      },
    ]));

    expect(plan.breakpoints).toEqual([
      {
        kind: "site-breakpoint",
        id: "0:1",
        name: "Desktop",
        bounds: { x: 120, y: -240, width: 1200, height: 1 },
      },
      {
        kind: "site-breakpoint",
        id: "0:2",
        name: "Mobile",
        bounds: { x: 560, y: -240, width: 390, height: 1 },
      },
    ]);
  });

  it("maps render units and variant frames to explicit breakpoint names", () => {
    const plan = createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      {
        type: "CANVAS",
        guid: { sessionID: 0, localID: 10 },
        name: "Internal Only Canvas",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
        internalOnly: true,
        visible: false,
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      },
      {
        type: "SYMBOL",
        guid: { sessionID: 0, localID: 20 },
        name: "Breakpoint=Desktop",
        parentIndex: { guid: { sessionID: 0, localID: 10 } },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: -100 },
        size: { x: 720, y: 1 },
      },
      {
        type: "RESPONSIVE_SET",
        guid: { sessionID: 0, localID: 1 },
        name: "Page",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
        transform: { m00: 1, m01: 0, m02: 50, m10: 0, m11: 1, m12: 80 },
        size: { x: 900, y: 500 },
      },
      {
        type: "FRAME",
        guid: { sessionID: 0, localID: 2 },
        name: "Desktop",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 32 },
        size: { x: 720, y: 400 },
      },
      {
        type: "REPEATER",
        guid: { sessionID: 0, localID: 3 },
        name: "Articles",
        parentIndex: { guid: { sessionID: 0, localID: 2 } },
        transform: { m00: 1, m01: 0, m02: 8, m10: 0, m11: 1, m12: 16 },
        size: { x: 100, y: 60 },
      },
    ]));

    expect(plan.breakpointVariants).toEqual([
      {
        kind: "site-breakpoint-variant",
        id: "0:2",
        responsiveSetId: "0:1",
        breakpointName: "Desktop",
        bounds: { x: 74, y: 112, width: 720, height: 400 },
      },
    ]);
    expect(plan.surfaces).toEqual([
      {
        kind: "site-render-surface",
        id: "0:1",
        label: "Page",
        bounds: { x: 50, y: 80, width: 900, height: 500 },
        breakpointNames: ["Desktop"],
        variantIds: ["0:2"],
      },
    ]);
    expect(plan.renderUnits.find((unit) => unit.id === "0:3")).toMatchObject({
      responsiveSetId: "0:1",
      responsiveBreakpointName: "Desktop",
    });
  });

  it("extracts explicit CMS selector and rich text bindings", () => {
    const plan = createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
      {
        type: "REPEATER",
        guid: { sessionID: 0, localID: 1 },
        name: "Articles",
        parentIndex: { guid: { sessionID: 0, localID: 0 } },
        transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 50 },
        size: { x: 400, y: 300 },
        cmsSelector: {
          cmsCollectionId: "collection-1",
          filterCriteria: {
            matchType: { name: "MATCH_ALL" },
            filters: [
              {
                cmsFieldId: "slug",
                op: { name: "EQUALS" },
                comparisonValue: "case-study",
              },
            ],
          },
          sorts: [],
          limit: 10,
        },
      },
      {
        type: "CMS_RICH_TEXT",
        guid: { sessionID: 0, localID: 2 },
        name: "Body",
        parentIndex: { guid: { sessionID: 0, localID: 1 } },
        transform: { m00: 1, m01: 0, m02: 24, m10: 0, m11: 1, m12: 32 },
        size: { x: 120, y: 80 },
        cmsRichTextStyleMap: {
          entries: [{ styleClass: { name: "PARAGRAPH" } }],
        },
        parameterConsumptionMap: {
          entries: [
            {
              variableData: {
                value: {
                  cmsAliasValue: {
                    collectionId: "collection-1",
                    itemId: "",
                    fieldId: "body",
                  },
                },
                dataType: { name: "CMS_ALIAS" },
                resolvedDataType: { name: "JS_RUNTIME_ALIAS" },
              },
              variableField: { name: "CMS_SERIALIZED_RICH_TEXT_DATA" },
            },
          ],
        },
        variableConsumptionMap: { entries: [] },
      },
    ]));

    expect(plan.cmsBindings).toEqual([
      {
        kind: "site-cms-selector-binding",
        unitId: "0:1",
        unitRole: "repeater",
        unitLabel: "Articles",
        collectionId: "collection-1",
        matchType: "MATCH_ALL",
        filters: [{ fieldId: "slug", operator: "EQUALS", comparisonValue: "case-study" }],
        sortCount: 0,
        limit: 10,
      },
      {
        kind: "site-cms-rich-text-binding",
        unitId: "0:2",
        unitRole: "cms-rich-text",
        unitLabel: "Body",
        aliases: [
          {
            source: "parameter",
            variableField: "CMS_SERIALIZED_RICH_TEXT_DATA",
            collectionId: "collection-1",
            fieldId: "body",
            itemId: "",
            dataType: "CMS_ALIAS",
            resolvedDataType: "JS_RUNTIME_ALIAS",
          },
        ],
        styleClasses: ["PARAGRAPH"],
      },
    ]);
  });

  it("throws when no layout render units exist", () => {
    expect(() => createSiteRenderPlan(createDocument([
      { type: "DOCUMENT", guid: { sessionID: 0, localID: 0 } },
    ]))).toThrow("Site render plan requires at least one layout render unit");
  });
});
