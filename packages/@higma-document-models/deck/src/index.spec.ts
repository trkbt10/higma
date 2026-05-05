/**
 * @file Deck domain summary contract tests.
 */

import { createDeckDocument, createDeckDomainSummary } from ".";

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

const summary: Parameters<typeof createDeckDocument>[1] = {
  totalNodes: 3,
  nodeTypes: new Map([
    ["SLIDE_GRID", 1],
    ["SLIDE", 2],
  ]),
  topLevelFields: new Map(),
};

const insights: Parameters<typeof createDeckDocument>[2] = {
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

describe("createDeckDomainSummary", () => {
  it("counts presentation node families", () => {
    const document = createDeckDocument(canvas, summary, insights);

    expect(createDeckDomainSummary(document)).toEqual({
      slideGridCount: 1,
      slideRowCount: 0,
      slideCount: 2,
      interactiveElementCount: 0,
      presentationNodeCount: 3,
    });
  });
});
