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
  addImageToFigDocumentContext,
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { figImageHashHexToBytes } from "@higma-document-models/fig/domain";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";
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

function imagePaint(imageHashHex: string, mode: FigImageScaleMode, scalingFactor?: number): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    image: { hash: figImageHashHexToBytes(imageHashHex) },
    imageScaleMode: { value: SCALE_MODE_VALUES[mode], name: mode },
    scale: scalingFactor,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function solidPaint(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

async function generate(): Promise<void> {
  console.log("Generating image-scale-modes fixture...");

  const empty = createEmptyFigDocument("Image Scale Modes");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Image Scale Modes").guid;
  const contextWithInternal = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const pngBytes = createCheckerboardPng();
  const imageHashHex = await computeSha1Hex(pngBytes);
  const contextWithImage = addImageToFigDocumentContext({
    context: contextWithInternal,
    image: {
    ref: imageHashHex,
    data: pngBytes,
    mimeType: "image/png",
    },
  });

  const FRAME_W = 160;
  const FRAME_H = 120;
  const GAP = 40;

  const finalContext = SCALE_MODES.reduce<FigDocumentContext>((acc, mode, index) => {
    const x = 100 + index * (FRAME_W + GAP);
    const y = 100;

    const frameResult = addNode({
      state,
      context: acc,
      pageGuid,
      parentGuid: null,
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
    const paint = imagePaint(imageHashHex, mode, mode === "TILE" ? 0.5 : undefined);

    const shapeResult = addNode({
      state,
      context: frameResult.context,
      pageGuid,
      parentGuid: frameResult.nodeGuid,
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
    return shapeResult.context;
  }, contextWithImage);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`\nGenerated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
