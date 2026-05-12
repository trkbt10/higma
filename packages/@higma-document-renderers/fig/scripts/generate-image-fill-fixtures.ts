#!/usr/bin/env bun
/**
 * @file Generate IMAGE fill fixture .fig file
 *
 * Tests image fill rendering:
 * - Basic image fill on rectangle
 * - Image fill with drop shadow
 * - Image fill on circle (avatar pattern)
 * - Image fill with corner radius
 * - Solid + IMAGE multi-fill (stacked)
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-image-fill-fixtures.ts
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
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigEffect, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/image-fill");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "image-fill.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };

function solidPaint(color: FigColor, opacity = 1): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity,
    visible: true,
    blendMode: "NORMAL",
  };
}

function imagePaint(imageRef: string, opacity = 1): FigPaint {
  return {
    type: "IMAGE",
    imageRef,
    imageHash: imageRef,
    imageScaleMode: "FILL",
    scaleMode: "FILL",
    opacity,
    visible: true,
    blendMode: "NORMAL",
  };
}

function dropShadow(ox: number, oy: number, radius: number, color: FigColor): FigEffect {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color,
    offset: { x: ox, y: oy },
    radius,
    blendMode: "NORMAL",
  };
}

/** Valid 4x4 RGB PNG — red/blue checkerboard. */
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

async function computeSha1Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const hashBuffer = await crypto.subtle.digest("SHA-1", buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
  readonly imageRef: string;
};

function addFrame(
  ctx: Ctx,
  doc: FigDesignDocument,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: FigColor,
): { doc: FigDesignDocument; frameId: FigNodeId } {
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [solidPaint(bg)],
      clipsContent: true,
    },
  });
  return { doc: r.doc, frameId: r.nodeId };
}

type Args = {
  readonly doc: FigDesignDocument;
  readonly ctx: Ctx;
  readonly frameX: number;
  readonly frameY: number;
};

function addImageFillBasic({ doc, ctx, frameX, frameY }: Args): FigDesignDocument {
  const f = addFrame(ctx, doc, "image-fill-basic", frameX, frameY, 160, 120, WHITE);
  return addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-rect",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [imagePaint(ctx.imageRef)],
    },
  }).doc;
}

function addImageFillWithShadow({ doc, ctx, frameX, frameY }: Args): FigDesignDocument {
  const f = addFrame(ctx, doc, "image-fill-shadow", frameX, frameY, 180, 140, LIGHT_GRAY);
  return addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-shadowed",
      x: 30, y: 30, width: 120, height: 80,
      cornerRadius: 12,
      fills: [imagePaint(ctx.imageRef)],
      effects: [dropShadow(0, 4, 8, { r: 0, g: 0, b: 0, a: 0.25 })],
    },
  }).doc;
}

function addImageFillCircle({ doc, ctx, frameX, frameY }: Args): FigDesignDocument {
  const f = addFrame(ctx, doc, "image-fill-circle", frameX, frameY, 120, 120, WHITE);
  return addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ELLIPSE",
      name: "image-avatar",
      x: 20, y: 20, width: 80, height: 80,
      fills: [imagePaint(ctx.imageRef)],
    },
  }).doc;
}

function addImageFillMulti({ doc, ctx, frameX, frameY }: Args): FigDesignDocument {
  const f = addFrame(ctx, doc, "image-fill-multi", frameX, frameY, 160, 120, LIGHT_GRAY);
  return addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "solid-plus-image",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [
        solidPaint({ r: 0.2, g: 0.3, b: 0.8, a: 1 }),
        imagePaint(ctx.imageRef, 0.6),
      ],
    },
  }).doc;
}

async function generateImageFillFixtures(): Promise<void> {
  console.log("Generating image fill fixtures...\n");

  const empty = createEmptyFigDesignDocument("ImageFill");
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

  const ctx: Ctx = { state, pageId, imageRef };

  const GRID_COLS = 4;
  const COL_WIDTH = 220;
  const ROW_HEIGHT = 180;
  const MARGIN = 50;

  type Builder = (args: Args) => FigDesignDocument;

  const builders: { name: string; fn: Builder }[] = [
    { name: "Image fill basic", fn: addImageFillBasic },
    { name: "Image fill + shadow", fn: addImageFillWithShadow },
    { name: "Image fill circle", fn: addImageFillCircle },
    { name: "Image fill multi-layer", fn: addImageFillMulti },
  ];

  const finalDoc = builders.reduce<FigDesignDocument>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = MARGIN + col * COL_WIDTH;
    const y = MARGIN + row * ROW_HEIGHT;
    return b.fn({ doc: acc, ctx, frameX: x, frameY: y });
  }, docWithImage);

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
  console.log(`\nNext steps:`);
  console.log(`1. Open ${OUTPUT_FILE} in Figma`);
  console.log(`2. Export each frame as SVG to fixtures/image-fill/actual/`);
  console.log(`3. Run: npx vitest run packages/@higma-document-renderers/fig/spec/image-fill.spec.ts`);
}

generateImageFillFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
