/**
 * @file Fig roundtrip state types retained by the domain document.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";

import type { FigBlob } from "./blob-path";
import type { FigNode } from "../types";

/** Metadata from a loaded fig-family package. */
export type FigMetadata = FigPackageMetadata;
export type FigImage = FigPackageImage;

/** Loaded fig-family file state preserved on a domain document for export. */
export type LoadedFigFile = {
  readonly schema: KiwiSchema;
  readonly compressedSchema: Uint8Array;
  readonly version: string;
  readonly nodeChanges: FigNode[];
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigImage>;
  readonly metadata: FigMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly messageHeader: Record<string, unknown>;
};
