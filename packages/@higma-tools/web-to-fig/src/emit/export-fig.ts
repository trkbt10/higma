/**
 * @file Top-level emit driver: ViewportIR → .fig bytes.
 *
 * Goes through `buildDocument` + `exportFig` from the canonical
 * `@higma-document-io/fig` pipeline. There is no separate write path —
 * fresh document construction and Kiwi schema injection happen inside
 * `exportFig`.
 *
 * Filesystem-free by design: callers (CLI / test harnesses / browser
 * tools) decide where the bytes go.
 */
import type { FigGuid } from "@higma-document-models/fig/types";
import type { ViewportIR } from "@higma-bridges/web-fig";
import { buildFigFileBytes } from "./build-fig-file";

export type EmitFigOptions = {
  /** Reserved for future builder options (compression, schema mode). */
  readonly compressionLevel?: number;
};

export type EmitFigResult = {
  readonly bytes: Uint8Array;
  /** IR id → assigned FigGuid. */
  readonly idMap: ReadonlyMap<string, FigGuid>;
};

/**
 * Convert a viewport IR into a `.fig` binary. The document carries
 * the captured assets so opening the result in Figma resolves any
 * image fills.
 */
export async function emitFig(viewport: ViewportIR, _options: EmitFigOptions = {}): Promise<EmitFigResult> {
  const built = await buildFigFileBytes(viewport);
  return { bytes: built.bytes, idMap: built.idMap };
}
