/**
 * @file ViewportIR → fig-file builder pipeline (single-viewport).
 *
 * This file's only job is the per-entry bookkeeping that genuinely
 * differs between single-viewport and multi-breakpoint emit:
 *
 *   - open a `createFigFile()` document and register the canvas
 *   - embed every `viewport.assets` entry as a fig blob and remember
 *     the `imageId → SHA-1 ref` map
 *   - call `emitNode` (the shared SoT in `node-emitters.ts`) with
 *     the root frame
 *   - finalise the file
 *
 * Per-node emission semantics — fills, strokes, auto-layout, line
 * height, text decoration, corner radius, vector winding — live in
 * `node-emitters.ts`. Both `buildFigFileBytes` and
 * `buildMultiFigFileBytes` consume it so a `.fig` produced for one
 * breakpoint is byte-for-byte identical (modulo the wrapper /
 * SYMBOL layer that's strictly multi-viewport's responsibility) to
 * what the multi-viewport path emits for the same `NodeIR`.
 */
import { createFigFile } from "@higma-document-io/fig/fig-file";
import type { ViewportIR } from "@higma-bridges/web-fig";
import { createIdCounter, emitNode, type EmitContext } from "./node-emitters";

/** Convert ViewportIR into a `.fig` (zip-wrapped) byte buffer plus IR id → fig localID map. */
export async function buildFigFileBytes(viewport: ViewportIR): Promise<{ readonly bytes: Uint8Array; readonly idMap: ReadonlyMap<string, number> }> {
  const file = createFigFile();
  const docID = file.addDocument(viewport.source);
  const canvasID = file.addCanvas(docID, "Web Capture");

  // Embed every captured image asset so the `.fig` is self-contained.
  // Without this pass `<img>`, `background-image: url(...)`, and the
  // legacy HTML4 `<body background>` paint as empty frames because
  // the IR's image fills reference an `imageId` that has no
  // corresponding fig blob. The asset registration *order* must
  // remain stable: identical bytes across captures should hash to
  // the same SHA-1 ref so two consecutive emits of the same IR
  // produce byte-identical `.fig`s (the writer keys image entries
  // by SHA-1, but the central directory entries land in insertion
  // order).
  const imageRefs = new Map<string, string>();
  for (const [, asset] of viewport.assets) {
    if (imageRefs.has(asset.id)) {
      continue;
    }
    const ref = await file.addImage(asset.bytes, asset.mime);
    imageRefs.set(asset.id, ref);
  }

  const idCounter = createIdCounter();
  const idMap = new Map<string, number>();
  const ctx: EmitContext = { file, idCounter, idMap, imageRefs };
  emitNode(ctx, canvasID, viewport.root);
  file.addInternalCanvas(docID);

  const bytes = await file.buildAsync({ fileName: viewport.source });
  return { bytes, idMap };
}
