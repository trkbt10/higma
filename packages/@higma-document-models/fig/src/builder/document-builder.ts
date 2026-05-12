/**
 * @file Model-layer document mutations limited to image/blob registry.
 *
 * Earlier revisions of this file shipped a parallel
 * `createEmptyFigDocument` + `addPage` + `addNode` + `setMetadata`
 * API. Those duplicated the io-layer equivalents (`createEmptyFigDesignDocument`,
 * `addPage`, `addNode` in `@higma-document-io/fig`) and had zero
 * external consumers — Phase 3 of the SoT consolidation deleted them
 * to collapse the construction surface to a single canonical entry
 * point.
 *
 * The remaining helpers (`addImage`, `addBlob`) are intentionally at
 * the model layer because the image / blob registries are part of the
 * `FigDesignDocument` shape itself — registering a new entry is a
 * pure transformation on that shape and does not depend on any
 * io-layer concept (NodeSpec / factory).
 */

import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigDesignBlob, FigDesignDocument } from "../domain";

/**
 * Register an image in the document's image map.
 *
 * `ref` is the image hash (used for cross-reference from any
 * IMAGE-paint's `imageRef`). The returned document carries the new
 * entry.
 */
export function addImage(
  doc: FigDesignDocument,
  ref: string,
  image: FigPackageImage,
): FigDesignDocument {
  const updated = new Map(doc.images);
  updated.set(ref, image);
  return { ...doc, images: updated };
}

/**
 * Append a binary blob to the document's blob array.
 *
 * Returns the updated document and the index at which the blob was
 * inserted. Use the returned index when emitting `fillGeometry` /
 * `strokeGeometry` references on shape nodes.
 */
export function addBlob(
  doc: FigDesignDocument,
  blob: FigDesignBlob,
): { doc: FigDesignDocument; blobIndex: number } {
  const blobIndex = doc.blobs.length;
  return {
    doc: { ...doc, blobs: [...doc.blobs, blob] },
    blobIndex,
  };
}
