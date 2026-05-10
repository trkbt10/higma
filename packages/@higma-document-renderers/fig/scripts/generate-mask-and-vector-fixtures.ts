#!/usr/bin/env bun
/**
 * @file Generate fixtures/mask-and-vector/mask-and-vector.fig
 *
 * Closes two coverage holes the survey uncovered:
 *
 *   - `mask: true` was only present in the real Figma export
 *     `inherit.fig`. No project-built fixture exercises mask
 *     handling, so a regression in `mask` encoding/parsing would
 *     slip past every CI run.
 *   - VECTOR + SVG-path/`vectorData` was likewise inherit-only.
 *     This fixture emits a `vectorNode` with two SVG sub-paths so
 *     the path-blob and `fillGeometry` round-trip get exercised in
 *     a small, regenerable file.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-mask-and-vector-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFigFile, frameNode, roundedRectNode, ellipseNode, vectorNode } from "@higma-document-io/fig/fig-file";
import type { Color } from "@higma-document-io/fig/fig-file";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/mask-and-vector");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "mask-and-vector.fig");

const FRAME_BG: Color = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const PHOTO_FILL: Color = { r: 0.55, g: 0.75, b: 0.95, a: 1 };
const VECTOR_FILL: Color = { r: 0.85, g: 0.4, b: 0.2, a: 1 };

const idRef = { value: 100 };
function id(): number {
  const current = idRef.value;
  idRef.value += 1;
  return current;
}

function addFrame(
  figFile: ReturnType<typeof createFigFile>,
  canvasID: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  const frameID = id();
  figFile.addFrame(
    frameNode(frameID, canvasID)
      .name(name)
      .size(w, h)
      .position(x, y)
      .background(FRAME_BG)
      .clipsContent(true)
      .exportAsSVG()
      .build(),
  );
  return frameID;
}

async function generate(): Promise<void> {
  console.log("Generating mask-and-vector fixture...");

  const figFile = createFigFile();
  const docID = figFile.addDocument("Mask & Vector");
  const canvasID = figFile.addCanvas(docID, "Mask & Vector");
  figFile.addInternalCanvas(docID);

  // Mask demo — a circular mask clipping a rectangle (the
  // canonical "avatar" pattern). The mask sibling has `mask: true`
  // and lives directly above its target in the parent's child
  // order so Figma's `applyMaskToSubsequent` semantics resolve.
  const maskFrameID = addFrame(figFile, canvasID, "mask-circle", 80, 80, 200, 200);

  // The mask itself: a circle. Add it FIRST so it sits at the
  // bottom of the child stack — Figma applies the mask to siblings
  // that come after it.
  figFile.addEllipse(
    ellipseNode(id(), maskFrameID)
      .name("mask-shape")
      .size(120, 120)
      .position(40, 40)
      .fill({ r: 1, g: 1, b: 1, a: 1 })
      .mask(true)
      .build(),
  );

  // The masked content: a coloured rectangle that should appear
  // clipped to the circle.
  figFile.addRoundedRectangle(
    roundedRectNode(id(), maskFrameID)
      .name("masked-photo")
      .size(160, 160)
      .position(20, 20)
      .fill(PHOTO_FILL)
      .cornerRadius(4)
      .build(),
  );

  // Vector demo — VECTOR node carrying two SVG path strings. The
  // builder turns each into a fillGeometry blob.
  const vectorFrameID = addFrame(figFile, canvasID, "vector-paths", 320, 80, 200, 200);
  figFile.addVector(
    vectorNode(id(), vectorFrameID)
      .name("vector-arrow")
      .size(120, 120)
      .position(40, 40)
      .fill(VECTOR_FILL)
      .path("M 0 40 L 60 40 L 60 20 L 120 60 L 60 100 L 60 80 L 0 80 Z")
      .path("M 70 50 L 95 60 L 70 70 Z")
      .windingRule("NONZERO")
      .build(),
  );

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figData = await figFile.buildAsync({ fileName: "mask-and-vector" });
  fs.writeFileSync(OUTPUT_FILE, figData);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(figData.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
