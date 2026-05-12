#!/usr/bin/env bun
/**
 * @file Generate rounded clip fixture .fig file
 *
 * Tests that frames with cornerRadius correctly clip their children
 * to a rounded rectangle shape. Covers:
 * - Single-level rounded clip
 * - Rounded clip with overflow content
 * - Nested rounded clips (different radii)
 * - Rounded clip with gradient child
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-clip-rounded-fixtures.ts
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
import type { FigColor, FigGradientStop, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/clip-rounded");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "clip-rounded.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };
const BLUE: FigColor = { r: 0.2, g: 0.4, b: 0.9, a: 1 };
const RED: FigColor = { r: 0.9, g: 0.2, b: 0.2, a: 1 };
const GREEN: FigColor = { r: 0.2, g: 0.7, b: 0.3, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

/**
 * Build a linear gradient paint. The transform matrix maps gradient
 * space → normalized object space (0..1, 0..1), mirroring the math
 * `linearHandlesToTransform` in `fig-file/paint`. We inline it here
 * to avoid pulling the legacy builder. `angleDeg=0` ⇒ left-to-right,
 * `90` ⇒ top-to-bottom (CSS convention).
 */
function linearGradientPaint(
  angleDeg: number,
  stops: readonly FigGradientStop[],
): FigPaint {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const startX = 0.5 - cos * 0.5;
  const startY = 0.5 - sin * 0.5;
  const endX = 0.5 + cos * 0.5;
  const endY = 0.5 + sin * 0.5;
  const dx = startX - endX;
  const dy = startY - endY;
  return {
    type: "GRADIENT_LINEAR",
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    stops,
    transform: {
      m00: dx,
      m01: -dy,
      m02: endX,
      m10: dy,
      m11: dx,
      m12: endY,
    },
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
  cornerRadius?: number,
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
      cornerRadius,
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
  fill: FigPaint,
): FigDesignDocument {
  return addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "RECTANGLE",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [fill],
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

type Args = {
  readonly doc: FigDesignDocument;
  readonly ctx: Ctx;
  readonly frameX: number;
  readonly frameY: number;
};

type Result = { readonly doc: FigDesignDocument };

function addRoundedClipBasic({ doc, ctx, frameX, frameY }: Args): Result {
  const f = addFrame(ctx, doc, null, "clip-rounded-basic", frameX, frameY, 160, 120, WHITE);
  const inner = addFrame(ctx, f.doc, f.frameId, "rounded-frame", 20, 20, 120, 80, LIGHT_GRAY, 20);
  const final = addRect(ctx, inner.doc, inner.frameId, "overflow", -20, -20, 160, 120, solidPaint(BLUE));
  return { doc: final };
}

function addRoundedClipPill({ doc, ctx, frameX, frameY }: Args): Result {
  const f = addFrame(ctx, doc, null, "clip-rounded-pill", frameX, frameY, 200, 80, WHITE);
  const inner = addFrame(ctx, f.doc, f.frameId, "pill-frame", 20, 20, 160, 40, null, 20);
  const final = addRect(ctx, inner.doc, inner.frameId, "content", 0, 0, 160, 40, solidPaint(RED));
  return { doc: final };
}

function addRoundedClipNested({ doc, ctx, frameX, frameY }: Args): Result {
  const f = addFrame(ctx, doc, null, "clip-rounded-nested", frameX, frameY, 180, 140, LIGHT_GRAY);
  const outer = addFrame(ctx, f.doc, f.frameId, "outer-rounded", 20, 20, 140, 100, WHITE, 24);
  const inner = addFrame(ctx, outer.doc, outer.frameId, "inner-rounded", 20, 20, 100, 60, null, 12);
  const final = addRect(ctx, inner.doc, inner.frameId, "content", -20, -20, 140, 100, solidPaint(GREEN));
  return { doc: final };
}

function addRoundedClipGradient({ doc, ctx, frameX, frameY }: Args): Result {
  const f = addFrame(ctx, doc, null, "clip-rounded-gradient", frameX, frameY, 160, 120, WHITE);
  const inner = addFrame(ctx, f.doc, f.frameId, "rounded-frame", 20, 20, 120, 80, null, 16);
  const gradient = linearGradientPaint(135, [
    { position: 0, color: { r: 1, g: 0.3, b: 0.3, a: 1 } },
    { position: 1, color: { r: 0.3, g: 0.3, b: 1, a: 1 } },
  ]);
  const final = addRect(ctx, inner.doc, inner.frameId, "gradient-content", -20, -20, 160, 120, gradient);
  return { doc: final };
}

function addRoundedClipCircle({ doc, ctx, frameX, frameY }: Args): Result {
  const f = addFrame(ctx, doc, null, "clip-rounded-circle", frameX, frameY, 120, 120, LIGHT_GRAY);
  const inner = addFrame(ctx, f.doc, f.frameId, "circle-frame", 20, 20, 80, 80, null, 40);
  const d1 = addRect(ctx, inner.doc, inner.frameId, "content", 0, 0, 80, 80, solidPaint(BLUE));
  const d2 = addEllipse(ctx, d1, inner.frameId, "overlap", 30, 30, 40, 40, RED);
  return { doc: d2 };
}

async function main(): Promise<void> {
  console.log("Generating clip-rounded fixtures...\n");

  const empty = createEmptyFigDesignDocument("ClipRounded");
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

  const GRID_COLS = 3;
  const COL_WIDTH = 230;
  const ROW_HEIGHT = 170;
  const MARGIN = 50;

  type Builder = (args: Args) => Result;

  const builders: { name: string; fn: Builder }[] = [
    { name: "Rounded clip basic", fn: addRoundedClipBasic },
    { name: "Rounded clip pill", fn: addRoundedClipPill },
    { name: "Rounded clip nested", fn: addRoundedClipNested },
    { name: "Rounded clip gradient", fn: addRoundedClipGradient },
    { name: "Rounded clip circle", fn: addRoundedClipCircle },
  ];

  const finalDoc = builders.reduce<FigDesignDocument>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    return b.fn({
      doc: acc,
      ctx,
      frameX: MARGIN + col * COL_WIDTH,
      frameY: MARGIN + row * ROW_HEIGHT,
    }).doc;
  }, doc0);

  for (const dir of [OUTPUT_DIR, path.join(OUTPUT_DIR, "actual"), path.join(OUTPUT_DIR, "snapshots")]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Frames: ${builders.length}\n`);
  for (const b of builders) {
    console.log(`  - ${b.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
