/**
 * @file Fig roundtrip state types retained by the domain document.
 */

import type { KiwiSchema } from "@higma-codecs/kiwi/types";
import type { FigPackageImage, FigPackageMetadata } from "@higma-figma-containers/package";

import type { FigBlob } from "./blob-path";
import type { FigNode } from "../types";

/**
 * Loaded fig-family file state preserved on a domain document for export.
 *
 * Image and metadata shapes are owned by `@higma-figma-containers/package`
 * (`FigPackageImage` / `FigPackageMetadata`) — the package SoT for what a
 * loaded `.fig` zip carries. Consumers must import those names directly from
 * `@higma-figma-containers/package`; domain does not re-publish them.
 */
export type LoadedFigFile = {
  readonly schema: KiwiSchema;
  readonly compressedSchema: Uint8Array;
  readonly version: string;
  readonly nodeChanges: FigNode[];
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
  readonly metadata: FigPackageMetadata | null;
  readonly thumbnail: Uint8Array | null;
  readonly messageHeader: Record<string, unknown>;
};
