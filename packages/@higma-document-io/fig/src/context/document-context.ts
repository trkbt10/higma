/** @file FigDocumentContext over the Kiwi document SoT. */

import type {
  FigBlob,
  FigKiwiDocumentIndex,
  FigStyleRegistry,
  LoadedFigFile,
} from "@higma-document-models/fig/domain";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import {
  EMPTY_FIG_STYLE_REGISTRY,
  getNodeType,
  guidToString,
  indexFigKiwiDocument,
} from "@higma-document-models/fig/domain";
import {
  buildFigStyleRegistryFromDocuments,
  createSymbolResolver,
  type SymbolResolver,
} from "@higma-document-models/fig/symbols";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { asBlobArray, readNodeChanges } from "../parser";

/**
 * Single source of truth for a loaded `.fig` file. The Kiwi document index
 * is the document view; SymbolResolver owns INSTANCE resolution.
 */
export type FigDocumentContext = {
  /**
   * Full roundtrip state when the source was a `.fig` package. Decoded
   * kiwi-canvas sources do not carry a package schema; their nodeChanges
   * are still exposed through `document`.
   */
  readonly loaded?: LoadedFigFile;

  /**
   * Indexed view over `loaded.nodeChanges`. It does not clone nodes or
   * become a second document; it only provides parent/child lookup over
   * the Kiwi document SoT.
   */
  readonly document: FigKiwiDocumentIndex;

  /** Resolver for every INSTANCE/SYMBOL decision in this document. */
  readonly symbolResolver: SymbolResolver;

  /** Document-wide style registry resolved from the Kiwi document. */
  readonly styleRegistry: FigStyleRegistry;

  /** Binary blobs referenced by node geometry/text fields. */
  readonly blobs: readonly FigBlob[];

  /** Images referenced by image paints. */
  readonly images: ReadonlyMap<string, FigPackageImage>;

  /** Explicit additional Kiwi sources used by resolver/registry construction. */
  readonly kiwiSourceDocuments: readonly FigDocumentContextKiwiSourceDocument[];

  /** Indexed lookup views for explicit additional Kiwi sources. */
  readonly kiwiSourceDocumentIndexes: readonly FigKiwiDocumentIndex[];

  /** Package metadata when available. */
  readonly metadata: FigPackageMetadata | null;
};

export type FigDocumentContextKiwiSourceDocument = {
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
};

export type CreateFigDocumentContextOptions = {
  readonly kiwiSourceDocuments?: readonly FigDocumentContextKiwiSourceDocument[];
};

type FigDocumentContextSource = {
  readonly loaded?: LoadedFigFile;
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
  readonly metadata: LoadedFigFile["metadata"];
  readonly kiwiSourceDocuments?: readonly FigDocumentContextKiwiSourceDocument[];
};

export type CreateFigDocumentContextFromNodeChangesOptions = {
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
  readonly metadata: LoadedFigFile["metadata"];
  readonly kiwiSourceDocuments?: readonly FigDocumentContextKiwiSourceDocument[];
};

export type ReplaceFigDocumentContextNodeChangesOptions = {
  readonly context: FigDocumentContext;
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
};

export type FigDocumentContextNodeContentEdit = {
  readonly before: LoadedFigFile["nodeChanges"][number];
  readonly after: LoadedFigFile["nodeChanges"][number];
};

export type ReplaceFigDocumentContextTransformOnlyNodeChangesOptions = {
  readonly context: FigDocumentContext;
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly changes: readonly FigDocumentContextNodeContentEdit[];
};

export type AddFigDocumentBlobOptions = {
  readonly context: FigDocumentContext;
  readonly blob: FigBlob;
};

export type AddFigDocumentImageOptions = {
  readonly context: FigDocumentContext;
  readonly image: FigPackageImage;
};

/** Build a `FigDocumentContext` from a buffer of raw `.fig` bytes. */
export async function createFigDocumentContext(
  buffer: Uint8Array,
  options?: CreateFigDocumentContextOptions,
): Promise<FigDocumentContext> {
  const loaded = await loadFigFile(buffer);
  return createFigDocumentContextFromLoaded(loaded, options);
}

/**
 * Build a `FigDocumentContext` from a pre-loaded file (e.g. produced by
 * `loadFigFile` directly when the caller needs to inspect it before
 * deriving the context).
 */
export function createFigDocumentContextFromLoaded(
  loaded: LoadedFigFile,
  options?: CreateFigDocumentContextOptions,
): FigDocumentContext {
  return createFigDocumentContextFromSource({
    loaded,
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images,
    metadata: loaded.metadata,
    kiwiSourceDocuments: options?.kiwiSourceDocuments,
  });
}

/**
 * Build a document context from a decoded kiwi-canvas message.
 */
export function createFigDocumentContextFromKiwiCanvas(
  canvas: FigmaKiwiCanvas,
  options?: CreateFigDocumentContextOptions,
): FigDocumentContext {
  return createFigDocumentContextFromSource({
    nodeChanges: readNodeChanges(canvas.nodeChanges),
    blobs: asBlobArray(canvas.blobs),
    images: canvas.images,
    metadata: canvas.metadata,
    kiwiSourceDocuments: options?.kiwiSourceDocuments,
  });
}

/**
 * Build a document context from an explicit Kiwi nodeChanges array.
 */
export function createFigDocumentContextFromNodeChanges(
  options: CreateFigDocumentContextFromNodeChangesOptions,
): FigDocumentContext {
  return createFigDocumentContextFromSource({
    nodeChanges: options.nodeChanges,
    blobs: options.blobs,
    images: options.images,
    metadata: options.metadata,
    kiwiSourceDocuments: options.kiwiSourceDocuments,
  });
}

/**
 * Re-index the same loaded fig package after editing its Kiwi nodeChanges.
 */
export function replaceFigDocumentContextNodeChanges({
  context,
  nodeChanges,
}: ReplaceFigDocumentContextNodeChangesOptions): FigDocumentContext {
  if (context.loaded) {
    return createFigDocumentContextFromLoaded(
      {
        ...context.loaded,
        nodeChanges,
        blobs: context.blobs,
        images: context.images,
        metadata: context.metadata,
      },
      { kiwiSourceDocuments: context.kiwiSourceDocuments },
    );
  }
  return createFigDocumentContextFromNodeChanges({
    nodeChanges,
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
    kiwiSourceDocuments: context.kiwiSourceDocuments,
  });
}

/**
 * Re-index Kiwi nodeChanges after edits whose only node field change is
 * `transform`. The Kiwi document index and SymbolResolver are rebuilt from the
 * edited document; style registry and explicit source indexes are retained
 * because transform does not participate in style lookup construction.
 */
export function replaceFigDocumentContextNodeChangesAfterTransformOnlyEdit({
  context,
  nodeChanges,
  changes,
}: ReplaceFigDocumentContextTransformOnlyNodeChangesOptions): FigDocumentContext {
  assertTransformOnlyNodeContentEdits(changes);
  const document = indexFigKiwiDocument(nodeChanges);
  const loaded = loadedFigFileWithNodeChanges(context, nodeChanges);
  const result = {
    document,
    symbolResolver: createSymbolResolver({
      document,
      symbolSourceDocuments: context.kiwiSourceDocumentIndexes,
      blobs: context.blobs,
    }),
    styleRegistry: context.styleRegistry,
    blobs: context.blobs,
    images: context.images,
    kiwiSourceDocuments: context.kiwiSourceDocuments,
    kiwiSourceDocumentIndexes: context.kiwiSourceDocumentIndexes,
    metadata: context.metadata,
  };
  if (loaded === undefined) {
    return result;
  }
  return {
    ...result,
    loaded,
  };
}

function loadedFigFileWithNodeChanges(
  context: FigDocumentContext,
  nodeChanges: LoadedFigFile["nodeChanges"],
): LoadedFigFile | undefined {
  if (context.loaded === undefined) {
    return undefined;
  }
  return {
    ...context.loaded,
    nodeChanges,
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
  };
}

function findExistingBlobIndex(
  existingBlobs: readonly FigBlob[],
  candidateBytes: readonly number[],
): number | undefined {
  for (let i = 0; i < existingBlobs.length; i += 1) {
    const existing = existingBlobs[i]!.bytes;
    if (existing.length !== candidateBytes.length) {
      continue;
    }
    let equal = true;
    for (let b = 0; b < existing.length; b += 1) {
      if (existing[b] !== candidateBytes[b]) {
        equal = false;
        break;
      }
    }
    if (equal) {
      return i;
    }
  }
  return undefined;
}

/**
 * Append one binary blob to the Kiwi document resources and re-index the
 * same nodeChanges with the new resource set. Identical-bytes blobs are
 * deduplicated against the existing set — the caller receives the
 * existing blob's index instead of a fresh entry. Figma's own exporter
 * dedupes identically (multiple shapes with the same geometry share one
 * Blob in the file's `blobs` array), so this matches the on-disk SoT
 * and keeps fixture round-trips byte-for-byte with Figma desktop.
 */
export function addBlobToFigDocumentContext({
  context,
  blob,
}: AddFigDocumentBlobOptions): { readonly context: FigDocumentContext; readonly blobIndex: number } {
  const existingIndex = findExistingBlobIndex(context.blobs, blob.bytes);
  if (existingIndex !== undefined) {
    return { context, blobIndex: existingIndex };
  }
  const blobIndex = context.blobs.length;
  const blobs = [...context.blobs, blob];
  if (context.loaded) {
    return {
      context: createFigDocumentContextFromLoaded(
        {
          ...context.loaded,
          nodeChanges: context.document.nodeChanges,
          blobs,
          images: context.images,
          metadata: context.metadata,
        },
        { kiwiSourceDocuments: context.kiwiSourceDocuments },
      ),
      blobIndex,
    };
  }
  return {
    context: createFigDocumentContextFromSource({
      nodeChanges: context.document.nodeChanges,
      blobs,
      images: context.images,
      metadata: context.metadata,
      kiwiSourceDocuments: context.kiwiSourceDocuments,
    }),
    blobIndex,
  };
}

/**
 * Add one package image by its own ref and re-index the same nodeChanges.
 */
export function addImageToFigDocumentContext({
  context,
  image,
}: AddFigDocumentImageOptions): FigDocumentContext {
  if (image.ref.length === 0) {
    throw new Error("addImageToFigDocumentContext requires a non-empty image ref");
  }
  if (image.data.byteLength === 0) {
    throw new Error(`addImageToFigDocumentContext requires bytes for image ${image.ref}`);
  }
  if (image.mimeType.length === 0) {
    throw new Error(`addImageToFigDocumentContext requires a MIME type for image ${image.ref}`);
  }
  const images = new Map(context.images);
  images.set(image.ref, image);
  if (context.loaded) {
    return createFigDocumentContextFromLoaded(
      {
        ...context.loaded,
        nodeChanges: context.document.nodeChanges,
        blobs: context.blobs,
        images,
        metadata: context.metadata,
      },
      { kiwiSourceDocuments: context.kiwiSourceDocuments },
    );
  }
  return createFigDocumentContextFromSource({
    nodeChanges: context.document.nodeChanges,
    blobs: context.blobs,
    images,
    metadata: context.metadata,
    kiwiSourceDocuments: context.kiwiSourceDocuments,
  });
}

function createFigDocumentContextFromSource(source: FigDocumentContextSource): FigDocumentContext {
  const document = indexFigKiwiDocument(source.nodeChanges);
  const kiwiSourceDocuments = source.kiwiSourceDocuments ?? [];
  assertKiwiSourceBlobTables(source.blobs, kiwiSourceDocuments);
  const kiwiSourceDocumentIndexes = kiwiSourceDocuments.map((kiwiSource) => indexFigKiwiDocument(kiwiSource.nodeChanges));
  const documentSources = [document, ...kiwiSourceDocumentIndexes];
  const styleRegistry = buildContextStyleRegistry(documentSources);
  const symbolResolver = createSymbolResolver({ document, symbolSourceDocuments: kiwiSourceDocumentIndexes, blobs: source.blobs });
  const images = mergeKiwiSourceImages(source.images, kiwiSourceDocuments);

  return {
    ...(source.loaded ? { loaded: source.loaded } : {}),
    document,
    symbolResolver,
    styleRegistry,
    blobs: source.blobs,
    images,
    kiwiSourceDocuments,
    kiwiSourceDocumentIndexes,
    metadata: source.metadata,
  };
}

function assertTransformOnlyNodeContentEdits(
  changes: readonly FigDocumentContextNodeContentEdit[],
): void {
  if (changes.length === 0) {
    throw new Error("FigDocumentContext transform-only replacement requires at least one changed Kiwi node");
  }
  for (const change of changes) {
    assertTransformOnlyNodeContentEdit(change);
  }
}

function assertTransformOnlyNodeContentEdit({
  before,
  after,
}: FigDocumentContextNodeContentEdit): void {
  if (before.guid === undefined || after.guid === undefined) {
    throw new Error("FigDocumentContext transform-only replacement requires GUID-bearing Kiwi nodes");
  }
  if (guidToString(before.guid) !== guidToString(after.guid)) {
    throw new Error("FigDocumentContext transform-only replacement must not change Kiwi node guid");
  }
  if (getNodeType(before) !== getNodeType(after)) {
    throw new Error("FigDocumentContext transform-only replacement must not change Kiwi node type");
  }
  if (!sameFigNodeExceptTransform(before, after)) {
    throw new Error(`FigDocumentContext transform-only replacement received non-transform edit for ${guidToString(before.guid)}`);
  }
}

function sameFigNodeExceptTransform(
  before: LoadedFigFile["nodeChanges"][number],
  after: LoadedFigFile["nodeChanges"][number],
): boolean {
  const keys = new Set<keyof LoadedFigFile["nodeChanges"][number]>([
    ...Object.keys(before) as (keyof LoadedFigFile["nodeChanges"][number])[],
    ...Object.keys(after) as (keyof LoadedFigFile["nodeChanges"][number])[],
  ]);
  for (const key of keys) {
    if (key === "transform") {
      continue;
    }
    if (before[key] !== after[key]) {
      return false;
    }
  }
  return true;
}

function buildContextStyleRegistry(documents: readonly FigKiwiDocumentIndex[]): FigStyleRegistry {
  if (!documentSourcesCarryNodes(documents)) {
    return EMPTY_FIG_STYLE_REGISTRY;
  }
  return buildFigStyleRegistryFromDocuments(documents);
}

function documentSourcesCarryNodes(documents: readonly FigKiwiDocumentIndex[]): boolean {
  return documents.some((document) => document.nodeChanges.length > 0);
}

function assertKiwiSourceBlobTables(
  primaryBlobs: readonly FigBlob[],
  kiwiSourceDocuments: readonly FigDocumentContextKiwiSourceDocument[],
): void {
  kiwiSourceDocuments.forEach((kiwiSource, index) => {
    assertKiwiSourceBlobTable(primaryBlobs, kiwiSource.blobs, index);
  });
}

function assertKiwiSourceBlobTable(
  primaryBlobs: readonly FigBlob[],
  sourceBlobs: readonly FigBlob[],
  sourceIndex: number,
): void {
  if (sourceBlobs.length > primaryBlobs.length) {
    throw new Error(`FigDocumentContext: kiwiSourceDocuments[${sourceIndex}] has a longer blob table than the primary document`);
  }
  sourceBlobs.forEach((sourceBlob, blobIndex) => {
    assertSameBlobBytes(primaryBlobs[blobIndex], sourceBlob, sourceIndex, blobIndex);
  });
}

function assertSameBlobBytes(
  primaryBlob: FigBlob | undefined,
  sourceBlob: FigBlob,
  sourceIndex: number,
  blobIndex: number,
): void {
  if (primaryBlob === undefined) {
    throw new Error(`FigDocumentContext: primary document is missing blob ${blobIndex} required by kiwiSourceDocuments[${sourceIndex}]`);
  }
  if (primaryBlob.bytes.length !== sourceBlob.bytes.length) {
    throw new Error(`FigDocumentContext: kiwiSourceDocuments[${sourceIndex}] blob ${blobIndex} length differs from the primary document`);
  }
  const mismatch = sourceBlob.bytes.some((byte, byteIndex) => primaryBlob.bytes[byteIndex] !== byte);
  if (mismatch) {
    throw new Error(`FigDocumentContext: kiwiSourceDocuments[${sourceIndex}] blob ${blobIndex} bytes differ from the primary document`);
  }
}

function mergeKiwiSourceImages(
  primaryImages: ReadonlyMap<string, FigPackageImage>,
  kiwiSourceDocuments: readonly FigDocumentContextKiwiSourceDocument[],
): ReadonlyMap<string, FigPackageImage> {
  if (kiwiSourceDocuments.length === 0) {
    return primaryImages;
  }
  const images = new Map(primaryImages);
  kiwiSourceDocuments.forEach((kiwiSource, sourceIndex) => {
    for (const [ref, image] of kiwiSource.images) {
      setKiwiSourceImage(images, ref, image, sourceIndex);
    }
  });
  return images;
}

function setKiwiSourceImage(
  images: Map<string, FigPackageImage>,
  ref: string,
  image: FigPackageImage,
  sourceIndex: number,
): void {
  const existing = images.get(ref);
  if (existing === undefined) {
    images.set(ref, image);
    return;
  }
  if (samePackageImage(existing, image)) {
    return;
  }
  throw new Error(`FigDocumentContext: kiwiSourceDocuments[${sourceIndex}] image ${ref} conflicts with the primary document`);
}

function samePackageImage(left: FigPackageImage, right: FigPackageImage): boolean {
  if (left.mimeType !== right.mimeType || left.data.byteLength !== right.data.byteLength) {
    return false;
  }
  return Array.from(left.data).every((byte, index) => right.data[index] === byte);
}
