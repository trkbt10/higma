#!/usr/bin/env bun
/**
 * @file Generate fixtures/stroke-styles/stroke-styles.fig
 *
 * Closes two stroke-related coverage holes:
 *
 *   - dashPattern: no fixture sets a dash pattern, so the
 *     encoder/decoder path for dashed strokes was never
 *     exercised end-to-end.
 *   - StrokeCap.ARROW_LINES / StrokeCap.ARROW_EQUILATERAL: no
 *     fixture emits an arrow line cap, so the round-trip never
 *     verified those enum members survive.
 *
 * Each frame holds one variant so the visual-diff renderer can
 * snapshot them independently.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-stroke-styles-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFigFile, frameNode, lineNode, roundedRectNode } from "@higma-document-io/fig/fig-file";
import type { Color } from "@higma-document-io/fig/fig-file";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/stroke-styles");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "stroke-styles.fig");

const FRAME_BG: Color = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const RECT_FILL: Color = { r: 0.92, g: 0.96, b: 1, a: 1 };
const STROKE: Color = { r: 0.15, g: 0.3, b: 0.85, a: 1 };
const LINE_COLOR: Color = { r: 0.85, g: 0.15, b: 0.15, a: 1 };

const idRef = { value: 100 };
function id(): number {
  const current = idRef.value;
  idRef.value += 1;
  return current;
}

function addFrame(figFile: ReturnType<typeof createFigFile>, canvasID: number, name: string, x: number, y: number, w: number, h: number): number {
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
  console.log("Generating stroke-styles fixture...");

  const figFile = createFigFile();
  const docID = figFile.addDocument("Stroke Styles");
  const canvasID = figFile.addCanvas(docID, "Stroke Styles");
  figFile.addInternalCanvas(docID);

  // Dashed strokes on rounded rectangles — three different patterns.
  const dashFrame1 = addFrame(figFile, canvasID, "dash-uniform", 100, 100, 200, 100);
  figFile.addRoundedRectangle(
    roundedRectNode(id(), dashFrame1)
      .name("dashed-uniform")
      .size(160, 60)
      .position(20, 20)
      .fill(RECT_FILL)
      .stroke(STROKE)
      .strokeWeight(3)
      .strokeAlign("INSIDE")
      .dashPattern([8, 4])
      .cornerRadius(8)
      .build(),
  );

  const dashFrame2 = addFrame(figFile, canvasID, "dash-asymmetric", 340, 100, 200, 100);
  figFile.addRoundedRectangle(
    roundedRectNode(id(), dashFrame2)
      .name("dashed-asymmetric")
      .size(160, 60)
      .position(20, 20)
      .fill(RECT_FILL)
      .stroke(STROKE)
      .strokeWeight(3)
      .strokeAlign("INSIDE")
      .dashPattern([12, 6, 2, 6])
      .cornerRadius(8)
      .build(),
  );

  const dashFrame3 = addFrame(figFile, canvasID, "dash-tight", 580, 100, 200, 100);
  figFile.addRoundedRectangle(
    roundedRectNode(id(), dashFrame3)
      .name("dashed-tight")
      .size(160, 60)
      .position(20, 20)
      .fill(RECT_FILL)
      .stroke(STROKE)
      .strokeWeight(2)
      .strokeAlign("INSIDE")
      .dashPattern([2, 2])
      .cornerRadius(8)
      .build(),
  );

  // Arrow caps — line nodes with each StrokeCap arrow variant.
  const ARROW_CASES = [
    { name: "arrow-lines", cap: "ARROW_LINES" as const },
    { name: "arrow-equilateral", cap: "ARROW_EQUILATERAL" as const },
  ];

  for (const [index, c] of ARROW_CASES.entries()) {
    const x = 100 + index * 240;
    const frameID = addFrame(figFile, canvasID, c.name, x, 260, 200, 100);
    figFile.addLine(
      lineNode(id(), frameID)
        .name(`line-${c.name}`)
        .position(20, 50)
        .length(160)
        .stroke(LINE_COLOR)
        .strokeWeight(4)
        .strokeCap(c.cap)
        .build(),
    );
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figData = await figFile.buildAsync({ fileName: "stroke-styles" });
  fs.writeFileSync(OUTPUT_FILE, figData);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(figData.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
