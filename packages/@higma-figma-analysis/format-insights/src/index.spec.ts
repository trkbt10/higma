/**
 * @file Format insight contract tests.
 */

import type { KiwiField, KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigmaNodeSummary } from "@higma-figma-runtime/node-summary";

import { createFigmaFormatInsights } from ".";

function field(name: string, value: number): KiwiField {
  return {
    name,
    type: "string",
    typeId: 1,
    isArray: false,
    value,
  };
}

const schema: KiwiSchema = {
  definitions: [
    { name: "NodeType", kind: "ENUM", fields: [field("FRAME", 1), field("TEXT", 2)] },
    { name: "Message", kind: "MESSAGE", fields: [field("nodeChanges", 1), field("blobs", 2)] },
    { name: "NodeChange", kind: "MESSAGE", fields: [field("type", 1), field("scene3d", 2)] },
  ],
};

const metadata: FigPackageMetadata = {
  raw: {
    client_meta: {
      background_color: { r: 1, g: 1, b: 1, a: 1 },
      render_coordinates: { x: 1, y: 2, width: 3, height: 4 },
      thumbnail_size: { width: 160, height: 90 },
    },
    developer_related_links: ["https://example.test"],
    exported_at: "2000-01-01T00:00:00.000Z",
    file_name: "example.document",
  },
  rawKeys: ["client_meta", "developer_related_links", "exported_at", "file_name"],
  clientMeta: {
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    renderCoordinates: { x: 1, y: 2, width: 3, height: 4 },
    thumbnailSize: { width: 160, height: 90 },
  },
  developerRelatedLinks: ["https://example.test"],
  exportedAt: "2000-01-01T00:00:00.000Z",
  fileName: "example.document",
};

const canvas: FigmaKiwiCanvas = {
  header: { magic: "fig-deck", version: "j", payloadSize: 0 },
  schema,
  message: {},
  nodeChanges: [],
  blobs: [],
  images: new Map(),
  metadata,
  thumbnail: null,
};

const nodeSummary: FigmaNodeSummary = {
  totalNodes: 2,
  nodeTypes: new Map([["FRAME", 2]]),
  topLevelFields: new Map([["type", 2]]),
};

describe("createFigmaFormatInsights", () => {
  it("extracts schema and metadata facts without product semantics", () => {
    const insights = createFigmaFormatInsights(canvas, nodeSummary);

    expect(insights.schema.definitionCount).toBe(3);
    expect(insights.schema.messageFields).toEqual(["blobs", "nodeChanges"]);
    expect(insights.schema.nodeChangeFields).toEqual(["scene3d", "type"]);
    expect(insights.schema.nodeTypeEnumValues).toEqual(["FRAME", "TEXT"]);
    expect(insights.metadata.rawKeys).toEqual(["client_meta", "developer_related_links", "exported_at", "file_name"]);
    expect(insights.metadata.clientMetaKeys).toEqual(["background_color", "render_coordinates", "thumbnail_size"]);
    expect(insights.metadata.hasRenderCoordinates).toBe(true);
    expect(insights.metadata.hasThumbnailSize).toBe(true);
    expect(insights.metadata.hasDeveloperRelatedLinks).toBe(true);
    expect(insights.metadata.hasExportTimestamp).toBe(true);
    expect(insights.nodeSummary).toBe(nodeSummary);
  });
});
