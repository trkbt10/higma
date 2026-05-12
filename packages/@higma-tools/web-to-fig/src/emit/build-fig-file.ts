/**
 * @file ViewportIR → .fig bytes (single-viewport).
 *
 * Goes through the canonical FigDesignDocument pipeline:
 *
 *   ViewportIR
 *     │ buildDocument            → FigDesignDocument (in-memory)
 *     │ exportFig                → .fig binary bytes
 *     ▼
 *   { bytes, idMap }
 *
 * `buildDocument` walks the IR via `irToSpecGraph` + `addNode`, so the
 * per-node emission semantics live in `ir-to-spec.ts` (the single SoT
 * for IR → FigDesignNode conversion). This module is the thin driver
 * that runs `buildDocument` and hands the result to `exportFig`.
 */
import { exportFig } from "@higma-document-io/fig";
import type { FigNodeId } from "@higma-document-models/fig/domain";
import type { ViewportIR } from "@higma-bridges/web-fig";
import { buildDocument } from "./build-document";

/**
 * Convert a single ViewportIR into a `.fig` (zip-wrapped) byte buffer
 * plus the IR id → FigNodeId map.
 */
export async function buildFigFileBytes(
  viewport: ViewportIR,
): Promise<{ readonly bytes: Uint8Array; readonly idMap: ReadonlyMap<string, FigNodeId> }> {
  const { doc, idMap } = buildDocument(viewport);
  const exported = await exportFig(doc);
  return { bytes: exported.data, idMap };
}
