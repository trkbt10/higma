#!/usr/bin/env bun
/**
 * @file Generate fixtures/text-styling/text-styling.fig
 *
 * Existing text fixtures (`text-comprehensive`, `text-webgl`,
 * `components`, `inherit`) only carry the default text-styling
 * enum members:
 *
 *   - `textCase`        — never set (always ORIGINAL)
 *   - `textDecoration`  — never set (always NONE)
 *   - `textAutoResize`  — never set (the builder defaults to
 *                         WIDTH_AND_HEIGHT and no fixture overrides
 *                         it)
 *   - `styleRuns`       — never set (no text fixture exercises
 *                         per-run styling)
 *
 * The roundtrip and renderer code paths still depend on every
 * one of those enum values being legally encodable. This fixture
 * exercises every member so any future regression surfaces here.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-text-styling-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFigFile, frameNode, textNode } from "@higma-document-io/fig/fig-file";
import type { Color, TextStyleRunData } from "@higma-document-io/fig/fig-file";
import type { TextCase, TextDecoration, TextAutoResize } from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/text-styling");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "text-styling.fig");

const FRAME_BG: Color = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const BLACK: Color = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const RED: Color = { r: 0.85, g: 0.15, b: 0.15, a: 1 };
const BLUE: Color = { r: 0.15, g: 0.3, b: 0.85, a: 1 };

const idRef = { value: 100 };
function id(): number {
  const current = idRef.value;
  idRef.value += 1;
  return current;
}

type CaseSpec = { readonly name: string; readonly value: TextCase; readonly text: string };
const TEXT_CASES: readonly CaseSpec[] = [
  { name: "case-original", value: "ORIGINAL", text: "Original Case" },
  { name: "case-upper", value: "UPPER", text: "Upper Case" },
  { name: "case-lower", value: "LOWER", text: "Lower Case" },
  { name: "case-title", value: "TITLE", text: "Title Case Words" },
  { name: "case-small-caps", value: "SMALL_CAPS", text: "Small Caps" },
  { name: "case-small-caps-forced", value: "SMALL_CAPS_FORCED", text: "Small Caps Forced" },
];

type DecorationSpec = { readonly name: string; readonly value: TextDecoration; readonly text: string };
const TEXT_DECORATIONS: readonly DecorationSpec[] = [
  { name: "deco-none", value: "NONE", text: "No decoration" },
  { name: "deco-underline", value: "UNDERLINE", text: "Underlined" },
  { name: "deco-strikethrough", value: "STRIKETHROUGH", text: "Strikethrough" },
];

type AutoResizeSpec = { readonly name: string; readonly value: TextAutoResize; readonly text: string };
const AUTO_RESIZE: readonly AutoResizeSpec[] = [
  { name: "resize-none", value: "NONE", text: "Fixed size box" },
  { name: "resize-width-and-height", value: "WIDTH_AND_HEIGHT", text: "Auto width + height" },
  { name: "resize-height", value: "HEIGHT", text: "Auto height only — text wraps inside the fixed width" },
];

function addText(figFile: ReturnType<typeof createFigFile>, parentID: number, opts: {
  readonly name: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly textCase?: TextCase;
  readonly decoration?: TextDecoration;
  readonly autoResize?: TextAutoResize;
  readonly styleRuns?: readonly TextStyleRunData[];
}): void {
  const builder = textNode(id(), parentID)
    .name(opts.name)
    .text(opts.text)
    .font("Inter", "Regular")
    .fontSize(16)
    .color(BLACK)
    .position(opts.x, opts.y)
    .size(opts.width ?? 320, 24);
  if (opts.textCase) {
    builder.textCase(opts.textCase);
  }
  if (opts.decoration) {
    builder.decoration(opts.decoration);
  }
  if (opts.autoResize) {
    builder.autoResize(opts.autoResize);
  }
  if (opts.styleRuns) {
    builder.styleRuns(opts.styleRuns);
  }
  figFile.addTextNode(builder.build());
}

function addRowFrame(figFile: ReturnType<typeof createFigFile>, canvasID: number, opts: {
  readonly name: string;
  readonly y: number;
  readonly height: number;
}): number {
  const frameID = id();
  figFile.addFrame(
    frameNode(frameID, canvasID)
      .name(opts.name)
      .size(720, opts.height)
      .position(80, opts.y)
      .background(FRAME_BG)
      .clipsContent(true)
      .exportAsSVG()
      .build(),
  );
  return frameID;
}

async function generate(): Promise<void> {
  console.log("Generating text-styling fixture...");

  const figFile = createFigFile();
  const docID = figFile.addDocument("Text Styling");
  const canvasID = figFile.addCanvas(docID, "Text Styling");
  figFile.addInternalCanvas(docID);

  const caseFrame = addRowFrame(figFile, canvasID, {
    name: "text-case",
    y: 80,
    height: TEXT_CASES.length * 36 + 32,
  });
  for (const [index, c] of TEXT_CASES.entries()) {
    addText(figFile, caseFrame, {
      name: c.name,
      text: c.text,
      x: 24,
      y: 16 + index * 36,
      textCase: c.value,
    });
  }

  const decoFrame = addRowFrame(figFile, canvasID, {
    name: "text-decoration",
    y: 80 + TEXT_CASES.length * 36 + 64,
    height: TEXT_DECORATIONS.length * 36 + 32,
  });
  for (const [index, d] of TEXT_DECORATIONS.entries()) {
    addText(figFile, decoFrame, {
      name: d.name,
      text: d.text,
      x: 24,
      y: 16 + index * 36,
      decoration: d.value,
    });
  }

  const resizeFrame = addRowFrame(figFile, canvasID, {
    name: "auto-resize",
    y: 80 + TEXT_CASES.length * 36 + 64 + TEXT_DECORATIONS.length * 36 + 64,
    height: AUTO_RESIZE.length * 60 + 32,
  });
  for (const [index, a] of AUTO_RESIZE.entries()) {
    addText(figFile, resizeFrame, {
      name: a.name,
      text: a.text,
      x: 24,
      y: 16 + index * 60,
      width: 280,
      autoResize: a.value,
    });
  }

  // Mixed-style runs: a single TEXT node carrying three contiguous
  // styleRun overrides so per-character style data round-trips.
  const runsFrame = addRowFrame(figFile, canvasID, {
    name: "style-runs",
    y: 80 + TEXT_CASES.length * 36 + 64 + TEXT_DECORATIONS.length * 36 + 64 + AUTO_RESIZE.length * 60 + 64,
    height: 80,
  });
  const characters = "RED green BLUE";
  const styleRuns: readonly TextStyleRunData[] = [
    { start: 0, end: 3, fillColor: RED },
    { start: 4, end: 9, fillColor: { r: 0.15, g: 0.7, b: 0.15, a: 1 } },
    { start: 10, end: 14, fillColor: BLUE },
  ];
  addText(figFile, runsFrame, {
    name: "mixed-runs",
    text: characters,
    x: 24,
    y: 24,
    styleRuns,
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figData = await figFile.buildAsync({ fileName: "text-styling" });
  fs.writeFileSync(OUTPUT_FILE, figData);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(figData.length / 1024).toFixed(1)} KB`);
  console.log(`Frames: 4 (text-case, text-decoration, auto-resize, style-runs)`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
