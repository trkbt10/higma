/**
 * @file ViewportIR → .fig bytes (single-viewport).
 *
 * `buildDocument` emits Kiwi nodeChanges directly; `exportFig` writes
 * those nodeChanges without projecting through another document model.
 */
import { exportFig } from "@higma-document-io/fig";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { ViewportIR } from "@higma-bridges/web-fig";
import { buildDocument } from "./build-document";

/**
 * Convert a single ViewportIR into a `.fig` (zip-wrapped) byte buffer
 * plus the IR id → FigGuid map.
 */
export async function buildFigFileBytes(
  viewport: ViewportIR,
): Promise<{ readonly bytes: Uint8Array; readonly idMap: ReadonlyMap<string, FigGuid> }> {
  const { context, idMap } = buildDocument(viewport);
  const exported = await exportFig(context);
  return { bytes: exported.data, idMap };
}
