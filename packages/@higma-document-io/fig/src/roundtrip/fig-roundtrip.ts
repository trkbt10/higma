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
import type { FigBlob, LoadedFigFile } from "@higma-document-models/fig/domain";
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

/**
 * Append a brand-new commands blob to the loaded file and return its
 * index. The returned index is what `fillGeometry[].commandsBlob` /
 * `strokeGeometry[].commandsBlob` reference.
 *
 * Used by refinement helpers that synthesise nodes whose geometry
 * does not already exist in the file (e.g. bootstrapping a style
 * proxy in a file that has none of that kind). The `LoadedFigFile.
 * blobs` slot is typed `readonly FigBlob[]` so callers cannot rewire
 * the array, but the underlying instance is the same one the save
 * path consumes — appending a single entry here is the SoT entry
 * point for that kind of mutation.
 */
export function addBlob(loaded: LoadedFigFile, blob: FigBlob): number {
  const blobs = loaded.blobs as FigBlob[];
  blobs.push(blob);
  return blobs.length - 1;
}

/**
 * Allocate the next free `(sessionID, localID)` for a brand-new node.
 *
 * Picks a sessionID strictly larger than every sessionID already in
 * the file's `nodeChanges`, and starts localIDs at 1 underneath it.
 * Subsequent calls increment localID, so a series of allocations all
 * land in the same fresh sessionID — clean to spot in diffs and
 * impossible to collide with the file's existing GUIDs.
 *
 * Returns a stateful allocator: keep a single instance for an entire
 * mutation pass and call `next()` once per new node.
 */
export type GuidAllocator = {
  readonly next: () => { readonly sessionID: number; readonly localID: number };
};

export function createGuidAllocator(loaded: LoadedFigFile): GuidAllocator {
  const maxSession = loaded.nodeChanges.reduce((max, node) => {
    const s = node.guid?.sessionID ?? 0;
    return s > max ? s : max;
  }, 0);
  const sessionID = maxSession + 1;
  const counter = { localID: 0 };
  return {
    next: () => {
      counter.localID = counter.localID + 1;
      return { sessionID, localID: counter.localID };
    },
  };
}

/** Find a node by name. */
export function findNodeByName(loaded: LoadedFigFile, name: string): FigNode | undefined {
  return loaded.nodeChanges.find((node) => node.name === name);
}

/** Find nodes by type. */
export function findNodesByType(loaded: LoadedFigFile, typeName: string): FigNode[] {
  return loaded.nodeChanges.filter((node) => node.type?.name === typeName);
}

/**
 * Replace a single nodeChange entry. Indexed by guid string. The
 * replacement is a shallow merge over the original — passing only the
 * fields you actually want to change. This is the SoT entry-point for
 * roundtrip-time mutations: callers do not reach into the array
 * directly, and they do not structurally cast a `FigNode` to a
 * widened object shape.
 *
 * No-op when the guid is unknown. The returned boolean indicates
 * whether a node was matched and updated.
 */
export function patchNodeChange(
  loaded: LoadedFigFile,
  guidString: string,
  patch: Partial<FigNode>,
): boolean {
  const idx = loaded.nodeChanges.findIndex((n) => {
    const g = n.guid;
    if (!g) {
      return false;
    }
    return `${g.sessionID}:${g.localID}` === guidString;
  });
  if (idx < 0) {
    return false;
  }
  const original = loaded.nodeChanges[idx];
  if (!original) {
    return false;
  }
  loaded.nodeChanges[idx] = { ...original, ...patch };
  return true;
}
