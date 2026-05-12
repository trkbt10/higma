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
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigPaint, FigStrokeCap } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/stroke-styles");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "stroke-styles.fig");

const FRAME_BG: FigColor = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const RECT_FILL: FigColor = { r: 0.92, g: 0.96, b: 1, a: 1 };
const STROKE: FigColor = { r: 0.15, g: 0.3, b: 0.85, a: 1 };
const LINE_COLOR: FigColor = { r: 0.85, g: 0.15, b: 0.15, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

type AddedFrame = {
  readonly doc: FigDesignDocument;
  readonly frameId: FigNodeId;
};

function addStyledFrame(
  doc: FigDesignDocument,
  state: FigBuilderState,
  pageId: FigPageId,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): AddedFrame {
  const result = addNode({
    state,
    doc,
    pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [solidPaint(FRAME_BG)],
      clipsContent: true,
    },
  });
  return { doc: result.doc, frameId: result.nodeId };
}

async function generate(): Promise<void> {
  console.log("Generating stroke-styles fixture...");

  const empty = createEmptyFigDesignDocument("Stroke Styles");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;

  // Internal Only Canvas is required by Figma's importer (see
  // packages/@higma-document-renderers/fig/CLAUDE.md). Add it up front
  // so the page ordering matches real Figma exports.
  const docWithInternal = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  // Dashed strokes on rounded rectangles — three different patterns.
  const f1 = addStyledFrame(docWithInternal, state, pageId, "dash-uniform", 100, 100, 200, 100);
  const r1 = addNode({
    state,
    doc: f1.doc,
    pageId,
    parentId: f1.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "dashed-uniform",
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      fills: [solidPaint(RECT_FILL)],
      strokes: [solidPaint(STROKE)],
      strokeWeight: 3,
      strokeAlign: "INSIDE",
      strokeDashes: [8, 4],
      cornerRadius: 8,
    },
  });

  const f2 = addStyledFrame(r1.doc, state, pageId, "dash-asymmetric", 340, 100, 200, 100);
  const r2 = addNode({
    state,
    doc: f2.doc,
    pageId,
    parentId: f2.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "dashed-asymmetric",
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      fills: [solidPaint(RECT_FILL)],
      strokes: [solidPaint(STROKE)],
      strokeWeight: 3,
      strokeAlign: "INSIDE",
      strokeDashes: [12, 6, 2, 6],
      cornerRadius: 8,
    },
  });

  const f3 = addStyledFrame(r2.doc, state, pageId, "dash-tight", 580, 100, 200, 100);
  const r3 = addNode({
    state,
    doc: f3.doc,
    pageId,
    parentId: f3.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "dashed-tight",
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      fills: [solidPaint(RECT_FILL)],
      strokes: [solidPaint(STROKE)],
      strokeWeight: 2,
      strokeAlign: "INSIDE",
      strokeDashes: [2, 2],
      cornerRadius: 8,
    },
  });

  // Arrow caps — line nodes with each StrokeCap arrow variant.
  // The Kiwi schema's `StrokeCap` enum names the two arrow variants
  // `ARROW_LINES` / `ARROW_EQUILATERAL`. Domain-level `FigStrokeCap`
  // mirrors the schema verbatim, so no bridging cast is required.
  const ARROW_CASES: readonly { readonly name: string; readonly cap: FigStrokeCap }[] = [
    { name: "arrow-lines", cap: "ARROW_LINES" },
    { name: "arrow-equilateral", cap: "ARROW_EQUILATERAL" },
  ];

  const arrowDoc = ARROW_CASES.reduce<FigDesignDocument>((acc, c, index) => {
    const x = 100 + index * 240;
    const frame = addStyledFrame(acc, state, pageId, c.name, x, 260, 200, 100);
    const line = addNode({
      state,
      doc: frame.doc,
      pageId,
      parentId: frame.frameId,
      spec: {
        type: "LINE",
        name: `line-${c.name}`,
        x: 20,
        y: 50,
        width: 160,
        height: 0,
        strokes: [solidPaint(LINE_COLOR)],
        strokeWeight: 4,
        strokeCap: c.cap,
      },
    });
    return line.doc;
  }, r3.doc);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(arrowDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
