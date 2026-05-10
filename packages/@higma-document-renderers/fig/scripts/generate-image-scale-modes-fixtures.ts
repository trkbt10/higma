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
import { createFigFile, frameNode, roundedRectNode, imagePaint } from "@higma-document-io/fig/fig-file";
import type { Color } from "@higma-document-io/fig/fig-file";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/image-scale-modes");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "image-scale-modes.fig");

const FRAME_BG: Color = { r: 0.96, g: 0.96, b: 0.96, a: 1 };

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

const SCALE_MODES = ["STRETCH", "FIT", "FILL", "TILE"] as const;

const idRef = { value: 100 };
function id(): number {
  const current = idRef.value;
  idRef.value += 1;
  return current;
}

async function generate(): Promise<void> {
  console.log("Generating image-scale-modes fixture...");

  const figFile = createFigFile();
  const docID = figFile.addDocument("Image Scale Modes");
  const canvasID = figFile.addCanvas(docID, "Image Scale Modes");
  figFile.addInternalCanvas(docID);

  const imageRef = await figFile.addImage(createCheckerboardPng(), "image/png");

  const FRAME_W = 160;
  const FRAME_H = 120;
  const GAP = 40;

  for (const [index, mode] of SCALE_MODES.entries()) {
    const x = 100 + index * (FRAME_W + GAP);
    const y = 100;

    const frameID = id();
    figFile.addFrame(
      frameNode(frameID, canvasID)
        .name(`scale-${mode.toLowerCase()}`)
        .size(FRAME_W, FRAME_H)
        .position(x, y)
        .background(FRAME_BG)
        .clipsContent(true)
        .exportAsSVG()
        .build(),
    );

    const builder = imagePaint(imageRef).scaleMode(mode);
    if (mode === "TILE") {
      // TILE requires an explicit factor — see the builder's
      // comment on scalingFactor. Half-size tiles are visually
      // distinct from FIT/FILL/STRETCH.
      builder.scale(0.5);
    }
    const paint = builder.build();

    const shapeID = id();
    figFile.addRoundedRectangle(
      roundedRectNode(shapeID, frameID)
        .name(`image-${mode.toLowerCase()}`)
        .size(120, 80)
        .position(20, 20)
        .cornerRadius(6)
        .fill(paint)
        .build(),
    );
    console.log(`  ${index + 1}/${SCALE_MODES.length} ${mode}`);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figData = await figFile.buildAsync({ fileName: "image-scale-modes" });
  fs.writeFileSync(OUTPUT_FILE, figData);
  console.log(`\nGenerated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(figData.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
