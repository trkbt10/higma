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
 * Append one binary blob to the Kiwi document resources and re-index the
 * same nodeChanges with the new resource set.
 */
export function addBlobToFigDocumentContext({
  context,
  blob,
}: AddFigDocumentBlobOptions): { readonly context: FigDocumentContext; readonly blobIndex: number } {
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
  const symbolSourceDocuments = kiwiSourceDocuments.map((kiwiSource) => indexFigKiwiDocument(kiwiSource.nodeChanges));
  const documentSources = [document, ...symbolSourceDocuments];
  const styleRegistry = buildContextStyleRegistry(documentSources);
  const symbolResolver = createSymbolResolver({ document, symbolSourceDocuments, blobs: source.blobs });
  const images = mergeKiwiSourceImages(source.images, kiwiSourceDocuments);

  return {
    ...(source.loaded ? { loaded: source.loaded } : {}),
    document,
    symbolResolver,
    styleRegistry,
    blobs: source.blobs,
    images,
    kiwiSourceDocuments,
    metadata: source.metadata,
  };
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
