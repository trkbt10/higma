/**
 * @file Site domain summary contract tests.
 */

import { createSiteDocument, createSiteDomainSummary } from ".";

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

const summary: Parameters<typeof createSiteDocument>[1] = {
  totalNodes: 4,
  nodeTypes: new Map([
    ["CMS_RICH_TEXT", 1],
    ["REPEATER", 1],
    ["RESPONSIVE_SET", 2],
  ]),
  topLevelFields: new Map(),
};

const insights: Parameters<typeof createSiteDocument>[2] = {
  schema: { definitionCount: 0, definitionNames: [], messageFields: [], nodeChangeFields: [], nodeTypeEnumValues: [] },
  metadata: {
    rawKeys: [],
    clientMetaKeys: [],
    hasRenderCoordinates: false,
    hasThumbnailSize: false,
    hasDeveloperRelatedLinks: false,
    hasExportTimestamp: false,
  },
  nodeSummary: summary,
};

describe("createSiteDomainSummary", () => {
  it("counts site layout node families", () => {
    const document = createSiteDocument(canvas, summary, insights);

    expect(createSiteDomainSummary(document)).toEqual({
      cmsRichTextCount: 1,
      repeaterCount: 1,
      responsiveSetCount: 2,
      symbolCount: 0,
      instanceCount: 0,
      layoutNodeCount: 4,
    });
  });
});
