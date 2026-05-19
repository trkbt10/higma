/** @file Fig export pipeline over the Kiwi document SoT. */

import { encodeRgbaToPng } from "@higma-codecs/png";
import { saveFigFile } from "@higma-document-io/fig/roundtrip";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import { createNodeChangesMessageHeader, getNodeType } from "@higma-document-models/fig/domain";
import type { FigDocumentContext } from "../context";
import {
  patchMetadataForThumbnail,
  prepareExportThumbnail,
  type FigPreparedThumbnail,
  type FigThumbnailRenderer,
} from "./thumbnail-pipeline";
import { FIGMA_KIWI_SCHEMA } from "@higma-figma-schema/profiles/schema";
import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import {
  FIG_THUMBNAIL_MAX_DIMENSION,
  type FigPackageMetadata,
} from "@higma-figma-containers/package";

export type FigExportOptions = {
  readonly compressionLevel?: number;
  readonly reencodeSchema?: boolean;
  readonly renderThumbnail?: FigThumbnailRenderer;
  readonly thumbnailMaxDimension?: number;
};

export type FigExportResult = {
  readonly data: Uint8Array;
  readonly size: number;
};

/**
 * Encode the current Kiwi document context as a .fig package.
 */
export async function exportFig(
  context: FigDocumentContext,
  options?: FigExportOptions,
): Promise<FigExportResult> {
  const preparedThumbnail = await prepareExportThumbnail(
    context,
    options?.renderThumbnail,
    options?.thumbnailMaxDimension ?? FIG_THUMBNAIL_MAX_DIMENSION,
  );
  if (context.loaded) {
    return exportRoundtrip(context, context.loaded, options, preparedThumbnail);
  }
  return exportFresh(context, options, preparedThumbnail);
}

function patchMetadataIfRendered(
  base: FigPackageMetadata,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata;
function patchMetadataIfRendered(
  base: FigPackageMetadata | null,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata | null;
function patchMetadataIfRendered(
  base: FigPackageMetadata | null,
  rendered: FigPreparedThumbnail | undefined,
): FigPackageMetadata | null {
  if (!rendered) {
    return base;
  }
  return patchMetadataForThumbnail(base, rendered);
}

async function exportRoundtrip(
  context: FigDocumentContext,
  loaded: LoadedFigFile,
  options: FigExportOptions | undefined,
  preparedThumbnail: FigPreparedThumbnail | undefined,
): Promise<FigExportResult> {
  const thumbnailBytes = preparedThumbnail?.png ?? loaded.thumbnail;
  const refreshedMetadata = patchMetadataIfRendered(loaded.metadata, preparedThumbnail);
  const modifiedLoaded: LoadedFigFile = {
    ...loaded,
    nodeChanges: context.document.nodeChanges,
    blobs: context.blobs,
    images: context.images,
    thumbnail: thumbnailBytes ?? null,
    metadata: refreshedMetadata,
  };

  const data = await saveFigFile(modifiedLoaded, {
    reencodeSchema: options?.reencodeSchema,
    ...(preparedThumbnail ? { thumbnail: preparedThumbnail.png } : {}),
    ...(modifiedLoaded.metadata ? { metadata: modifiedLoaded.metadata } : {}),
  });

  return { data, size: data.length };
}

function firstCanvasName(context: FigDocumentContext): string {
  for (const root of context.document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    const firstCanvas = context.document.childrenOf(root).find((node) => getNodeType(node) === "CANVAS");
    if (firstCanvas) {
      return firstCanvas.name ?? "Generated";
    }
  }
  return "Generated";
}

function defaultFreshMetadata(context: FigDocumentContext): FigPackageMetadata {
  const thumbW = FIG_THUMBNAIL_MAX_DIMENSION;
  const thumbH = Math.round((FIG_THUMBNAIL_MAX_DIMENSION * 3) / 4);
  return {
    raw: {},
    rawKeys: [],
    clientMeta: {
      backgroundColor: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
      thumbnailSize: { width: thumbW, height: thumbH },
      renderCoordinates: { x: 0, y: 0, width: thumbW * 2, height: thumbH * 2 },
    },
    fileName: firstCanvasName(context),
    developerRelatedLinks: [],
    exportedAt: new Date().toISOString(),
  };
}

function defaultFreshThumbnail(): Uint8Array {
  const rgba = new Uint8ClampedArray([0x00, 0x00, 0x00, 0x00]);
  return encodeRgbaToPng(rgba, 1, 1);
}

async function exportFresh(
  context: FigDocumentContext,
  _options: FigExportOptions | undefined,
  preparedThumbnail: FigPreparedThumbnail | undefined,
): Promise<FigExportResult> {
  const baseMetadata = context.metadata ?? defaultFreshMetadata(context);
  const metadata = patchMetadataIfRendered(baseMetadata, preparedThumbnail);
  const thumbnail = preparedThumbnail?.png ?? defaultFreshThumbnail();
  const minimalLoaded: LoadedFigFile = {
    schema: FIGMA_KIWI_SCHEMA as KiwiSchema,
    compressedSchema: new Uint8Array(0),
    version: "e",
    nodeChanges: context.document.nodeChanges,
    blobs: context.blobs,
    images: context.images,
    metadata,
    thumbnail,
    messageHeader: createNodeChangesMessageHeader(),
  };

  const data = await saveFigFile(minimalLoaded, {
    reencodeSchema: true,
    metadata,
    thumbnail,
  });

  return { data, size: data.length };
}
