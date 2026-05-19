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
  buildFigStyleRegistry,
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

  /** Package metadata when available. */
  readonly metadata: FigPackageMetadata | null;
};

type FigDocumentContextSource = {
  readonly loaded?: LoadedFigFile;
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
  readonly metadata: LoadedFigFile["metadata"];
};

export type CreateFigDocumentContextFromNodeChangesOptions = {
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
  readonly blobs: LoadedFigFile["blobs"];
  readonly images: LoadedFigFile["images"];
  readonly metadata: LoadedFigFile["metadata"];
};

export type ReplaceFigDocumentContextNodeChangesOptions = {
  readonly context: FigDocumentContext;
  readonly nodeChanges: LoadedFigFile["nodeChanges"];
};

/** Build a `FigDocumentContext` from a buffer of raw `.fig` bytes. */
export async function createFigDocumentContext(buffer: Uint8Array): Promise<FigDocumentContext> {
  const loaded = await loadFigFile(buffer);
  return createFigDocumentContextFromLoaded(loaded);
}

/**
 * Build a `FigDocumentContext` from a pre-loaded file (e.g. produced by
 * `loadFigFile` directly when the caller needs to inspect it before
 * deriving the context).
 */
export function createFigDocumentContextFromLoaded(loaded: LoadedFigFile): FigDocumentContext {
  return createFigDocumentContextFromSource({
    loaded,
    nodeChanges: loaded.nodeChanges,
    blobs: loaded.blobs,
    images: loaded.images,
    metadata: loaded.metadata,
  });
}

/**
 * Build a document context from a decoded kiwi-canvas message.
 */
export function createFigDocumentContextFromKiwiCanvas(canvas: FigmaKiwiCanvas): FigDocumentContext {
  return createFigDocumentContextFromSource({
    nodeChanges: readNodeChanges(canvas.nodeChanges),
    blobs: asBlobArray(canvas.blobs),
    images: canvas.images,
    metadata: canvas.metadata,
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
    return createFigDocumentContextFromLoaded({
      ...context.loaded,
      nodeChanges,
      blobs: context.blobs,
      images: context.images,
      metadata: context.metadata,
    });
  }
  return createFigDocumentContextFromNodeChanges({
    nodeChanges,
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
  });
}

function createFigDocumentContextFromSource(source: FigDocumentContextSource): FigDocumentContext {
  const document = indexFigKiwiDocument(source.nodeChanges);
  const styleRegistry = document.nodeChanges.length > 0 ? buildFigStyleRegistry(document) : EMPTY_FIG_STYLE_REGISTRY;
  const symbolResolver = createSymbolResolver({
    document,
    styleRegistry,
  });

  return {
    ...(source.loaded ? { loaded: source.loaded } : {}),
    document,
    symbolResolver,
    styleRegistry,
    blobs: source.blobs,
    images: source.images,
    metadata: source.metadata,
  };
}
