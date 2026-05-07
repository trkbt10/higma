/**
 * @file Fig-product roundtrip wrapper over fig-family runtime IO.
 */

import {
  loadFigFamilyFile,
  saveFigFamilyFile,
  type FigFamilyImage,
  type FigFamilyMetadata,
  type LoadedFigFamilyFile,
  type SaveFigFamilyOptions,
} from "@higma-figma-runtime/roundtrip";
import type { FigCanvasMagic } from "@higma-figma-schema/profiles";
import type {
  FigImage as DomainFigImage,
  FigMetadata as DomainFigMetadata,
  LoadedFigFile as DomainLoadedFigFile,
} from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

export type FigImage = DomainFigImage;
export type FigMetadata = DomainFigMetadata;
export type LoadedFigFile = DomainLoadedFigFile;

export type SaveFigOptions = {
  readonly metadata?: Partial<FigMetadata>;
  readonly thumbnail?: Uint8Array;
  readonly images?: ReadonlyMap<string, FigImage>;
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
    images: loaded.images as ReadonlyMap<string, FigImage>,
    metadata: loaded.metadata as FigMetadata | null,
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
    images: loaded.images as ReadonlyMap<FigFamilyImage["ref"], FigFamilyImage>,
    metadata: loaded.metadata as FigFamilyMetadata | null,
    thumbnail: loaded.thumbnail,
    messageHeader: loaded.messageHeader,
  };
}

function createSaveOptions(options: SaveFigOptions | undefined): SaveFigFamilyOptions {
  return {
    metadata: options?.metadata,
    thumbnail: options?.thumbnail,
    images: options?.images as ReadonlyMap<string, FigFamilyImage> | undefined,
    reencodeSchema: options?.reencodeSchema,
    canvasMagic: options?.canvasMagic ?? FIG_PRODUCT_CANVAS_MAGIC,
  };
}

/** Save a loaded .fig file back to bytes. */
export async function saveFigFile(loaded: LoadedFigFile, options?: SaveFigOptions): Promise<Uint8Array> {
  return saveFigFamilyFile(createLoadedFigFamilyFile(loaded), createSaveOptions(options));
}

/** Clone a loaded .fig file. */
export function cloneFigFile(loaded: LoadedFigFile): LoadedFigFile {
  return {
    ...loaded,
    nodeChanges: loaded.nodeChanges.map((node) => ({ ...node })),
  };
}

/** Add a node change to a loaded file. */
export function addNodeChange(loaded: LoadedFigFile, node: FigNode): void {
  loaded.nodeChanges.push(node);
}

/** Find a node by name. */
export function findNodeByName(loaded: LoadedFigFile, name: string): FigNode | undefined {
  return loaded.nodeChanges.find((node) => node.name === name);
}

/** Find nodes by type. */
export function findNodesByType(loaded: LoadedFigFile, typeName: string): FigNode[] {
  return loaded.nodeChanges.filter((node) => node.type?.name === typeName);
}
