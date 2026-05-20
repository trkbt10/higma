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
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES, STROKE_ALIGN_VALUES, STROKE_CAP_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor, FigNode, FigPaint, FigStrokeCap } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/stroke-styles");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "stroke-styles.fig");

const FRAME_BG: FigColor = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const RECT_FILL: FigColor = { r: 0.92, g: 0.96, b: 1, a: 1 };
const STROKE: FigColor = { r: 0.15, g: 0.3, b: 0.85, a: 1 };
const LINE_COLOR: FigColor = { r: 0.85, g: 0.15, b: 0.15, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function strokeCapValue(name: FigStrokeCap): NonNullable<FigNode["strokeCap"]> {
  return { value: STROKE_CAP_VALUES[name], name };
}

type AddedFrame = {
  readonly context: FigDocumentContext;
  readonly frameId: FigGuid;
};

function addStyledFrame(
  context: FigDocumentContext,
  state: FigBuilderState,
  pageGuid: FigGuid,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): AddedFrame {
  const result = addNode({
    state,
    context,
    pageGuid,
    parentGuid: null,
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
  return { context: result.context, frameId: result.nodeGuid };
}

async function generate(): Promise<void> {
  console.log("Generating stroke-styles fixture...");

  const empty = createEmptyFigDocument("Stroke Styles");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Stroke Styles").guid;

  // Internal Only Canvas is required by Figma's importer (see
  // packages/@higma-document-renderers/fig/CLAUDE.md). Add it up front
  // so the page ordering matches real Figma exports.
  const contextWithInternal = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  // Dashed strokes on rounded rectangles — three different patterns.
  const f1 = addStyledFrame(contextWithInternal, state, pageGuid, "dash-uniform", 100, 100, 200, 100);
  const r1 = addNode({
    state,
    context: f1.context,
    pageGuid,
    parentGuid: f1.frameId,
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
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" },
      strokeDashes: [8, 4],
      cornerRadius: 8,
    },
  });

  const f2 = addStyledFrame(r1.context, state, pageGuid, "dash-asymmetric", 340, 100, 200, 100);
  const r2 = addNode({
    state,
    context: f2.context,
    pageGuid,
    parentGuid: f2.frameId,
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
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" },
      strokeDashes: [12, 6, 2, 6],
      cornerRadius: 8,
    },
  });

  const f3 = addStyledFrame(r2.context, state, pageGuid, "dash-tight", 580, 100, 200, 100);
  const r3 = addNode({
    state,
    context: f3.context,
    pageGuid,
    parentGuid: f3.frameId,
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
      strokeAlign: { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" },
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

  const arrowContext = ARROW_CASES.reduce<FigDocumentContext>((acc, c, index) => {
    const x = 100 + index * 240;
    const frame = addStyledFrame(acc, state, pageGuid, c.name, x, 260, 200, 100);
    const line = addNode({
      state,
      context: frame.context,
      pageGuid,
      parentGuid: frame.frameId,
      spec: {
        type: "LINE",
        name: `line-${c.name}`,
        x: 20,
        y: 50,
        width: 160,
        height: 0,
        strokes: [solidPaint(LINE_COLOR)],
        strokeWeight: 4,
        strokeCap: strokeCapValue(c.cap),
      },
    });
    return line.context;
  }, r3.context);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(arrowContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
