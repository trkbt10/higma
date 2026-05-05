/**
 * @file Product-free format insights for decoded fig-family documents.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigmaNodeSummary } from "@higma-figma-runtime/node-summary";

export type FigmaSchemaInsights = {
  readonly definitionCount: number;
  readonly definitionNames: readonly string[];
  readonly messageFields: readonly string[];
  readonly nodeChangeFields: readonly string[];
  readonly nodeTypeEnumValues: readonly string[];
};

export type FigmaMetadataInsights = {
  readonly rawKeys: readonly string[];
  readonly clientMetaKeys: readonly string[];
  readonly hasRenderCoordinates: boolean;
  readonly hasThumbnailSize: boolean;
  readonly hasDeveloperRelatedLinks: boolean;
  readonly hasExportTimestamp: boolean;
};

export type FigmaFormatInsights = {
  readonly schema: FigmaSchemaInsights;
  readonly metadata: FigmaMetadataInsights;
  readonly nodeSummary: FigmaNodeSummary;
};

function fieldNames(schema: KiwiSchema, definitionName: string): readonly string[] {
  const definition = schema.definitions.find((entry) => entry.name === definitionName);
  if (!definition) {
    return [];
  }
  return definition.fields.map((field) => field.name).sort();
}

function enumValues(schema: KiwiSchema, definitionName: string): readonly string[] {
  const definition = schema.definitions.find((entry) => entry.name === definitionName);
  if (!definition) {
    return [];
  }
  return definition.fields.map((field) => field.name).sort();
}

function schemaInsights(schema: KiwiSchema): FigmaSchemaInsights {
  return {
    definitionCount: schema.definitions.length,
    definitionNames: schema.definitions.map((definition) => definition.name).sort(),
    messageFields: fieldNames(schema, "Message"),
    nodeChangeFields: fieldNames(schema, "NodeChange"),
    nodeTypeEnumValues: enumValues(schema, "NodeType"),
  };
}

function metadataInsights(metadata: FigPackageMetadata | null): FigmaMetadataInsights {
  const clientMetaRaw = metadata?.raw.client_meta;
  const clientMetaKeys = getClientMetaKeys(clientMetaRaw);
  return {
    rawKeys: metadata?.rawKeys ?? [],
    clientMetaKeys,
    hasRenderCoordinates: Boolean(metadata?.clientMeta?.renderCoordinates),
    hasThumbnailSize: Boolean(metadata?.clientMeta?.thumbnailSize),
    hasDeveloperRelatedLinks: Boolean(metadata?.developerRelatedLinks?.length),
    hasExportTimestamp: Boolean(metadata?.exportedAt),
  };
}

function getClientMetaKeys(clientMetaRaw: unknown): readonly string[] {
  if (!clientMetaRaw || typeof clientMetaRaw !== "object") {
    return [];
  }
  return Object.keys(clientMetaRaw as Record<string, unknown>).sort();
}

/** Build product-free schema, metadata, and node summary insights. */
export function createFigmaFormatInsights(
  canvas: FigmaKiwiCanvas,
  nodeSummary: FigmaNodeSummary,
): FigmaFormatInsights {
  return {
    schema: schemaInsights(canvas.schema),
    metadata: metadataInsights(canvas.metadata),
    nodeSummary,
  };
}
