#!/usr/bin/env bun
/**
 * @file Build a deliberately corrupt `.fig` fixture for fig-lint.
 *
 * The fixture lives at `corrupt-multi.fig` next to this script. It
 * is the "mourning suit" of fig files — a single payload that
 * trips every error-class fig-lint can fire, so the lint suite has
 * a stable regression target instead of relying on accidentally
 * broken fixtures elsewhere in the monorepo.
 *
 * Strategy:
 *
 *   1. Generate a healthy ZIP-wrapped `.fig` via the canonical
 *      `createEmptyFigDesignDocument` + `addNode` + `exportFig`
 *      pipeline (gives us a real schema and message body to mutate).
 *   2. Open the ZIP, drop `thumbnail.png`, and patch the message
 *      stream so:
 *        - the Internal Only Canvas is missing (`fig.canvas.internal-only`)
 *        - shape nodes lose their `strokeWeight/Align/Join`
 *          (`fig.shape.stroke-fields`)
 *        - a paintable shape lacks fillGeometry (`fig.shape.fill-geometry`)
 *   3. Repackage into a fresh ZIP and write to disk.
 *
 * The resulting fixture is committed alongside the script. Running
 * the script regenerates it deterministically — there's no
 * randomness in the inputs.
 *
 * Usage:
 *   bun packages/@higma-document-io/fig/spec/fixtures/build-corrupt-fig.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";
import {
  createEmptyZipPackage,
  loadZipPackage,
} from "@higma-primitives/zip";
import {
  getFigCanvasPayload,
  parseFigCanvasHeader,
  buildFigCanvasHeader,
} from "@higma-figma-containers/canvas";
import { decompressFigChunk, compressZstd } from "@higma-codecs/compression";
import {
  decodeFigMessage,
  decodeFigSchema,
  splitFigChunks,
} from "@higma-codecs/kiwi/decoder";
import { StreamingFigEncoder } from "@higma-codecs/kiwi/stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, "corrupt-multi.fig");

const FRAME_BG: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };
const RECT_FILL: FigColor = { r: 0.85, g: 0.45, b: 0.45, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true, blendMode: "NORMAL" };
}

async function generate(): Promise<void> {
  console.log("Building corrupt fig fixture...");

  // 1. Healthy baseline (full schema, valid structure). The Internal
  //    Only Canvas page gets dropped during the corruption pass below
  //    so fig-lint can surface `fig.canvas.internal-only`.
  const empty = createEmptyFigDesignDocument("Page");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const docWithInternal = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;
  const frameResult = addNode({
    state,
    doc: docWithInternal,
    pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "frame",
      x: 60,
      y: 60,
      width: 160,
      height: 80,
      fills: [solidPaint(FRAME_BG)],
      clipsContent: true,
    },
  });
  const rectResult = addNode({
    state,
    doc: frameResult.doc,
    pageId,
    parentId: frameResult.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "rect",
      x: 20,
      y: 20,
      width: 80,
      height: 40,
      fills: [solidPaint(RECT_FILL)],
      cornerRadius: 4,
    },
  });

  const healthyExport = await exportFig(rectResult.doc);
  const healthy = healthyExport.data;

  // 2. Open the ZIP and corrupt the message in-place.
  const inputZip = await loadZipPackage(healthy);
  const canvasBuffer = inputZip.readBinary("canvas.fig");
  if (!canvasBuffer) {
    throw new Error("canvas.fig missing from healthy build");
  }
  const canvasBytes = new Uint8Array(canvasBuffer);
  const header = parseFigCanvasHeader(canvasBytes);
  const payload = getFigCanvasPayload(canvasBytes);
  const chunks = splitFigChunks(payload, header.payloadSize);
  const schemaBytes = decompressFigChunk(chunks.schema);
  const schema = decodeFigSchema(schemaBytes);
  const messageBytes = decompressFigChunk(chunks.data);
  const message = decodeFigMessage(schema, messageBytes, "Message");

  const nodeChanges = (message.nodeChanges as Record<string, unknown>[] | undefined) ?? [];

  // Drop the Internal Only Canvas (fig.canvas.internal-only).
  const filteredChanges = nodeChanges.filter((node) => {
    const name = node.name;
    if (typeof name === "string" && name === "Internal Only Canvas") {
      return false;
    }
    return true;
  });

  // Strip stroke fields off every FRAME / ROUNDED_RECTANGLE
  // (fig.shape.stroke-fields). Drop fillGeometry off the
  // ROUNDED_RECTANGLE so visible-blobs fires too
  // (fig.shape.fill-geometry).
  for (const node of filteredChanges) {
    const type = node.type as { name?: string } | undefined;
    if (!type) {
      continue;
    }
    if (type.name === "FRAME" || type.name === "ROUNDED_RECTANGLE") {
      delete node.strokeWeight;
      delete node.strokeAlign;
      delete node.strokeJoin;
    }
    if (type.name === "ROUNDED_RECTANGLE") {
      delete node.fillGeometry;
    }
  }

  message.nodeChanges = filteredChanges;

  // 3. Re-encode the message.
  const encoder = new StreamingFigEncoder({ schema });
  encoder.writeHeader({
    type: message.type as { value: number },
    sessionID: (message.sessionID as number) ?? 0,
    ackID: (message.ackID as number) ?? 0,
    blobs: (message.blobs as readonly { bytes: number[] }[] | undefined) ?? [],
  });
  for (const node of filteredChanges) {
    encoder.writeNodeChange(node);
  }
  const reEncodedMessage = encoder.finalize();
  const compressedMessage = await compressZstd(reEncodedMessage, 3);

  const dataChunk = new Uint8Array(4 + compressedMessage.length);
  new DataView(dataChunk.buffer).setUint32(0, compressedMessage.length, true);
  dataChunk.set(compressedMessage, 4);

  const newHeader = buildFigCanvasHeader(chunks.schema.length, "e");
  const newCanvas = new Uint8Array(newHeader.length + chunks.schema.length + dataChunk.length);
  newCanvas.set(newHeader, 0);
  newCanvas.set(chunks.schema, newHeader.length);
  newCanvas.set(dataChunk, newHeader.length + chunks.schema.length);

  // 4. Repackage — deliberately drop thumbnail.png so
  // fig.zip.thumbnail fires.
  const outZip = createEmptyZipPackage();
  outZip.writeBinary("canvas.fig", newCanvas);
  const meta = inputZip.readText("meta.json");
  if (meta) {
    outZip.writeText("meta.json", meta);
  }
  // (no thumbnail.png on purpose)

  const buffer = await outZip.toArrayBuffer({ compressionLevel: 6 });
  const corruptBytes = new Uint8Array(buffer);
  fs.writeFileSync(OUTPUT_FILE, corruptBytes);

  console.log(`Wrote ${OUTPUT_FILE} (${corruptBytes.length} bytes)`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
