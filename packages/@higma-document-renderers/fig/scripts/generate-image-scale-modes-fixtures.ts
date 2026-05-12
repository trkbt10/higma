#!/usr/bin/env bun
/**
 * @file Generate fixtures/image-scale-modes/image-scale-modes.fig
 *
 * The Figma Kiwi schema declares four `ImageScaleMode` values:
 * STRETCH, FIT, FILL, TILE. Before this fixture only `STRETCH` was
 * exercised by a project-generated file (`image-fill.fig`), and
 * `FIT` / `TILE` had no fixture coverage at all — that gap was
 * what allowed the previous SoT mismatch on `ImageScaleMode` to
 * stay hidden. This fixture closes the hole by emitting one frame
 * per scale mode, all four sharing the same image so visual diffs
 * stay diff-able.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-image-scale-modes-fixtures.ts
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
import { addImage } from "@higma-document-models/fig/builder";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";
import type { FigColor, FigImageScaleMode, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/image-scale-modes");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "image-scale-modes.fig");

const FRAME_BG: FigColor = { r: 0.96, g: 0.96, b: 0.96, a: 1 };

/**
 * Generate a valid 4x4 checkerboard PNG as test image. Same payload
 * the existing image-fill fixture uses — keeps comparisons stable.
 */
function createCheckerboardPng(): Uint8Array {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAF0lEQVR4nGP4bwQE" +
    "/yEkA5wFJBlwygAAQTIWMSbY+UYAAAAASUVORK5CYII=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compute the SHA-1 hex digest of an image. Matches Figma's image-ref
 * convention: every paint referencing image bytes addresses them by
 * SHA-1, and the `.fig` zip stores each entry at `images/<sha1-hex>`.
 */
async function computeSha1Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const hashBuffer = await crypto.subtle.digest("SHA-1", buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SCALE_MODES = ["STRETCH", "FIT", "FILL", "TILE"] as const;

function imagePaint(imageRef: string, mode: FigImageScaleMode, scalingFactor?: number): FigPaint {
  return {
    type: "IMAGE",
    imageRef,
    imageHash: imageRef,
    image: undefined,
    imageScaleMode: mode,
    scaleMode: mode,
    scalingFactor,
    scale: scalingFactor,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

async function generate(): Promise<void> {
  console.log("Generating image-scale-modes fixture...");

  const empty = createEmptyFigDesignDocument("Image Scale Modes");
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

  const pngBytes = createCheckerboardPng();
  const imageRef = await computeSha1Hex(pngBytes);
  const docWithImage = addImage(docWithInternal, imageRef, {
    ref: imageRef,
    data: pngBytes,
    mimeType: "image/png",
  });

  const FRAME_W = 160;
  const FRAME_H = 120;
  const GAP = 40;

  const finalDoc = SCALE_MODES.reduce<FigDesignDocument>((acc, mode, index) => {
    const x = 100 + index * (FRAME_W + GAP);
    const y = 100;

    const frameResult = addNode({
      state,
      doc: acc,
      pageId,
      parentId: null,
      spec: {
        type: "FRAME",
        name: `scale-${mode.toLowerCase()}`,
        x,
        y,
        width: FRAME_W,
        height: FRAME_H,
        fills: [solidPaint(FRAME_BG)],
        clipsContent: true,
      },
    });

    // TILE requires an explicit factor — half-size tiles are visually
    // distinct from FIT/FILL/STRETCH.
    const paint = imagePaint(imageRef, mode, mode === "TILE" ? 0.5 : undefined);

    const shapeResult = addNode({
      state,
      doc: frameResult.doc,
      pageId,
      parentId: frameResult.nodeId,
      spec: {
        type: "ROUNDED_RECTANGLE",
        name: `image-${mode.toLowerCase()}`,
        x: 20,
        y: 20,
        width: 120,
        height: 80,
        cornerRadius: 6,
        fills: [paint],
      },
    });
    console.log(`  ${index + 1}/${SCALE_MODES.length} ${mode}`);
    return shapeResult.doc;
  }, docWithImage);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`\nGenerated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
