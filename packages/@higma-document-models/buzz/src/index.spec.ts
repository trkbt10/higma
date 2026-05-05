/**
 * @file Buzz domain summary contract tests.
 */

import { createBuzzDocument, createBuzzDomainSummary } from ".";

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

const summary: Parameters<typeof createBuzzDocument>[1] = {
  totalNodes: 5,
  nodeTypes: new Map([
    ["VECTOR", 3],
    ["SYMBOL", 1],
    ["BOOLEAN_OPERATION", 1],
  ]),
  topLevelFields: new Map(),
};

const insights: Parameters<typeof createBuzzDocument>[2] = {
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

describe("createBuzzDomainSummary", () => {
  it("counts template node families", () => {
    const document = createBuzzDocument(canvas, summary, insights);

    expect(createBuzzDomainSummary(document)).toEqual({
      slideGridCount: 0,
      slideRowCount: 0,
      symbolCount: 1,
      vectorCount: 3,
      booleanOperationCount: 1,
      templateNodeCount: 5,
    });
  });
});
