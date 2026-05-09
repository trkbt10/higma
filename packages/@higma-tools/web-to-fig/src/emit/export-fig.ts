/**
 * @file Top-level emit driver: ViewportIR → .fig bytes.
 *
 * Goes through the low-level fig-file builder so the bundled Figma
 * Kiwi schema is used (the high-level `exportFig` from
 * `@higma-document-io/fig` does not yet support fresh documents —
 * `exportFresh` writes an empty schema that the encoder rejects).
 *
 * Filesystem-free by design: callers (CLI / test harnesses / browser
 * tools) decide where the bytes go.
 */
import type { ViewportIR } from "@higma-bridges/web-fig";
import { buildFigFileBytes } from "./build-fig-file";

export type EmitFigOptions = {
  /** Reserved for future builder options (compression, schema mode). */
  readonly compressionLevel?: number;
};

export type EmitFigResult = {
  readonly bytes: Uint8Array;
  /** IR id → assigned fig localID. */
  readonly idMap: ReadonlyMap<string, number>;
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
