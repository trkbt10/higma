/**
 * @file Fig-product roundtrip wrapper over fig-family runtime IO.
 *
 * Image / metadata / loaded-file shapes are owned by their respective SoT
 * packages and consumed directly here:
 *   - image / metadata: `@higma-figma-containers/package`
 *     (`FigPackageImage` / `FigPackageMetadata`)
 *   - loaded file:      `@higma-document-models/fig/domain` (`LoadedFigFile`)
 *
 * This module deliberately does not re-publish those names under shorter
 * aliases — callers must import them from their origin packages.
 */

import {
  loadFigFamilyFile,
  saveFigFamilyFile,
  type LoadedFigFamilyFile,
  type SaveFigFamilyOptions,
} from "@higma-figma-runtime/roundtrip";
import type { FigCanvasMagic } from "@higma-figma-schema/profiles";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigNode } from "@higma-document-models/fig/types";

export type SaveFigOptions = {
  readonly metadata?: Partial<FigPackageMetadata>;
  readonly thumbnail?: Uint8Array;
  readonly images?: ReadonlyMap<string, FigPackageImage>;
  readonly reencodeSchema?: boolean;
  readonly canvasMagic?: FigCanvasMagic;
};

const FIG_PRODUCT_CANVAS_MAGIC: FigCanvasMagic = "fig-kiwi";

/** Load a .fig file for roundtrip editing. */
export async function loadFigFile(data: Uint8Array): Promise<LoadedFigFile> {
  const loaded = await loadFigFamilyFile<FigNode>(data);
  return {
    schema: loaded.schema,
    compressedSchema: loaded.compressedSchema,
    version: loaded.version,
    nodeChanges: [...loaded.nodeChanges],
    blobs: loaded.blobs as LoadedFigFile["blobs"],
    images: loaded.images as ReadonlyMap<string, FigPackageImage>,
    metadata: loaded.metadata as FigPackageMetadata | null,
    thumbnail: loaded.thumbnail,
    messageHeader: loaded.messageHeader,
  };
}

function createLoadedFigFamilyFile(loaded: LoadedFigFile): LoadedFigFamilyFile<FigNode, LoadedFigFile["blobs"][number]> {
  return {
    schema: loaded.schema,
    compressedSchema: loaded.compressedSchema,
    version: loaded.version,
    canvasMagic: FIG_PRODUCT_CANVAS_MAGIC,
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images as ReadonlyMap<FigPackageImage["ref"], FigPackageImage>,
    metadata: loaded.metadata as FigPackageMetadata | null,
    thumbnail: loaded.thumbnail,
    messageHeader: loaded.messageHeader,
  };
}

function createSaveOptions(options: SaveFigOptions | undefined): SaveFigFamilyOptions {
  return {
    metadata: options?.metadata,
    thumbnail: options?.thumbnail,
    images: options?.images as ReadonlyMap<string, FigPackageImage> | undefined,
    reencodeSchema: options?.reencodeSchema,
    canvasMagic: options?.canvasMagic ?? FIG_PRODUCT_CANVAS_MAGIC,
  };
}

/** Save a loaded .fig file back to bytes. */
export async function saveFigFile(loaded: LoadedFigFile, options?: SaveFigOptions): Promise<Uint8Array> {
  return saveFigFamilyFile(createLoadedFigFamilyFile(loaded), createSaveOptions(options));
}

