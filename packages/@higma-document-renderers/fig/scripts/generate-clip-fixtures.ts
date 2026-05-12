#!/usr/bin/env bun
/**
 * @file Generate clip fixture .fig file
 *
 * Creates a .fig file with clipping test cases using only rect/ellipse
 * (star/polygon don't have fillGeometry blobs in the builder, so Figma can't render them).
 *
 * - 1-level clip: shapes inside a single clip frame
 * - 2-level nested clips: shapes inside double-nested clip frames
 * - 3-level nested clips: shapes inside triple-nested clip frames
 * - Overflow: shapes exceeding clip bounds
 * - Nested with shapes: rect+ellipse in 2-level nested clip
 * - Mixed depths: shapes at different nesting depths
 * - Overlapping: shapes overlapping inside clip
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-clip-fixtures.ts
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
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/clips");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "clips.fig");

const white: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const lightGray: FigColor = { r: 0.94, g: 0.94, b: 0.94, a: 1 };

function rgb(r: number, g: number, b: number): FigColor {
  return { r, g, b, a: 1 };
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

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
};

function addFrame(
  ctx: Ctx,
  doc: FigDesignDocument,
  parentId: FigNodeId | null,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: FigColor | null,
): { doc: FigDesignDocument; frameId: FigNodeId } {
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "FRAME",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: bg ? [solidPaint(bg)] : [],
      clipsContent: true,
    },
  });
  return { doc: r.doc, frameId: r.nodeId };
}

function addRect(
  ctx: Ctx,
  doc: FigDesignDocument,
  parentId: FigNodeId,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: FigColor,
  cornerRadius?: number,
): FigDesignDocument {
  return addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [solidPaint(fill)],
      cornerRadius,
    },
  }).doc;
}

function addEllipse(
  ctx: Ctx,
  doc: FigDesignDocument,
  parentId: FigNodeId,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: FigColor,
): FigDesignDocument {
  return addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "ELLIPSE",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [solidPaint(fill)],
    },
  }).doc;
}

async function generateClipFixtures(): Promise<void> {
  console.log("Generating clip fixtures...");

  const empty = createEmptyFigDesignDocument("Clips");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const ctx: Ctx = { state, pageId };

  const doc0 = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  const GRID_COLS = 4;
  const GRID_GAP = 30;
  const MARGIN = 50;
  const frameIndexRef = { value: 0 };

  function gridPos(): { x: number; y: number } {
    const idx = frameIndexRef.value;
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);
    frameIndexRef.value += 1;
    return {
      x: MARGIN + col * (220 + GRID_GAP),
      y: MARGIN + row * (220 + GRID_GAP),
    };
  }

  // clip-1level
  const p1 = gridPos();
  const f1 = addFrame(ctx, doc0, null, "clip-1level", p1.x, p1.y, 200, 200, white);
  const d1a = addRect(ctx, f1.doc, f1.frameId, "rect", 20, 20, 80, 80, rgb(0.3, 0.5, 0.9), 8);
  const d1b = addEllipse(ctx, d1a, f1.frameId, "circle", 100, 100, 60, 60, rgb(0.9, 0.3, 0.3));

  // clip-2level
  const p2 = gridPos();
  const f2 = addFrame(ctx, d1b, null, "clip-2level", p2.x, p2.y, 200, 200, white);
  const inner2 = addFrame(ctx, f2.doc, f2.frameId, "inner", 20, 20, 160, 160, lightGray);
  const d2a = addEllipse(ctx, inner2.doc, inner2.frameId, "circle", 40, 40, 80, 80, rgb(1, 0.8, 0));
  const d2b = addRect(ctx, d2a, inner2.frameId, "rect", 10, 90, 60, 60, rgb(0.3, 0.7, 0.3), 6);

  // clip-3level
  const p3 = gridPos();
  const f3 = addFrame(ctx, d2b, null, "clip-3level", p3.x, p3.y, 200, 200, white);
  const level2 = addFrame(ctx, f3.doc, f3.frameId, "level-2", 10, 10, 180, 180, lightGray);
  const level3 = addFrame(ctx, level2.doc, level2.frameId, "level-3", 10, 10, 160, 160, null);
  const d3a = addEllipse(ctx, level3.doc, level3.frameId, "circle", 40, 40, 80, 80, rgb(0.4, 0.7, 0.4));
  const d3b = addRect(ctx, d3a, level3.frameId, "rect", 10, 10, 50, 50, rgb(0.9, 0.3, 0.6), 8);

  // clip-overflow
  const p4 = gridPos();
  const f4 = addFrame(ctx, d3b, null, "clip-overflow", p4.x, p4.y, 200, 200, white);
  const d4a = addRect(ctx, f4.doc, f4.frameId, "overflow-rect", 100, 100, 150, 150, rgb(0.2, 0.6, 0.9), 12);
  const d4b = addEllipse(ctx, d4a, f4.frameId, "overflow-circle", -30, -30, 120, 120, rgb(0.9, 0.5, 0.2));

  // clip-nested-shapes
  const p5 = gridPos();
  const f5 = addFrame(ctx, d4b, null, "clip-nested-shapes", p5.x, p5.y, 200, 200, white);
  const inner5 = addFrame(ctx, f5.doc, f5.frameId, "inner", 20, 20, 160, 160, null);
  const d5a = addRect(ctx, inner5.doc, inner5.frameId, "rect-large", 30, 30, 100, 100, rgb(0.3, 0.3, 0.9), 10);
  const d5b = addEllipse(ctx, d5a, inner5.frameId, "circle-small", 10, 10, 60, 60, rgb(0.9, 0.7, 0));

  // clip-mixed
  const p6 = gridPos();
  const f6 = addFrame(ctx, d5b, null, "clip-mixed", p6.x, p6.y, 200, 200, white);
  const d6a = addRect(ctx, f6.doc, f6.frameId, "outer-rect", 10, 10, 60, 60, rgb(0.9, 0.3, 0.3), 6);
  const inner6 = addFrame(ctx, d6a, f6.frameId, "inner", 70, 70, 120, 120, lightGray);
  const d6b = addRect(ctx, inner6.doc, inner6.frameId, "inner-rect", 20, 20, 80, 80, rgb(0.3, 0.7, 0.3), 8);
  const d6c = addEllipse(ctx, d6b, inner6.frameId, "inner-ellipse", 60, 60, 50, 50, rgb(0.3, 0.5, 0.9));

  // clip-shapes-overlap
  const p7 = gridPos();
  const f7 = addFrame(ctx, d6c, null, "clip-shapes-overlap", p7.x, p7.y, 200, 200, white);
  const d7a = addRect(ctx, f7.doc, f7.frameId, "bg-rect", 40, 40, 120, 120, rgb(0.2, 0.5, 0.8), 10);
  const d7b = addEllipse(ctx, d7a, f7.frameId, "overlap-circle", 60, 60, 100, 100, rgb(0.9, 0.3, 0.3));
  const d7c = addRect(ctx, d7b, f7.frameId, "top-rect", 20, 20, 80, 80, rgb(1, 0.8, 0), 8);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const actualDir = path.join(OUTPUT_DIR, "actual");
  if (!fs.existsSync(actualDir)) {
    fs.mkdirSync(actualDir, { recursive: true });
  }

  const exported = await exportFig(d7c);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Frames: ${frameIndexRef.value}`);
  console.log(`\nFrame list:`);
  const names = [
    "clip-1level",
    "clip-2level",
    "clip-3level",
    "clip-overflow",
    "clip-nested-shapes",
    "clip-mixed",
    "clip-shapes-overlap",
  ];
  for (const name of names) {
    console.log(`  - ${name}`);
  }
}

generateClipFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
