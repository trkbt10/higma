#!/usr/bin/env bun
/**
 * @file Generate advanced paint fixture .fig file
 *
 * Tests paint features that are missing from existing fixtures:
 *
 * 1. Angular (conic) gradient
 * 2. Diamond gradient
 * 3. Multiple fill layers (stacked paints)
 * 4. IMAGE fill (currently covered by image-scale-modes; omitted here)
 * 5. MASK layer
 * 6. Combinations: gradient + effect, etc.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-paint-advanced-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
  updateNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type {
  FigColor,
  FigEffect,
  FigGradientStop,
  FigPaint,
} from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/paint-advanced");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "paint-advanced.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };

// =============================================================================
// Paint helpers
// =============================================================================

function solidPaint(color: FigColor, opacity = 1): FigPaint {
  return { type: "SOLID", color, opacity, visible: true, blendMode: "NORMAL" };
}

/**
 * Build the gradient → object-space transform for a linear gradient
 * travelling along `angleDeg` (CSS convention: 0° = right, 90° = down).
 * Matches the math in `demo-document.ts` so existing gradient
 * fixtures stay equivalent.
 */
function linearGradientPaint(angleDeg: number, stops: readonly FigGradientStop[]): FigPaint {
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
    stops,
    transform: { m00: dx, m01: -dy, m02: endX, m10: dy, m11: dx, m12: endY },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function radialGradientPaint(stops: readonly FigGradientStop[]): FigPaint {
  return {
    type: "GRADIENT_RADIAL",
    stops,
    transform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 0.5, m12: 0.5 },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function angularGradientPaint(stops: readonly FigGradientStop[], rotationDeg = 0): FigPaint {
  // Angular gradients rotate around the shape centre; the on-disk
  // transform is the same shape-normalised matrix, just routed
  // through the angular path. Apply the rotation by rebuilding the
  // matrix from a 0..1 unit basis.
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    type: "GRADIENT_ANGULAR",
    stops,
    transform: {
      m00: 0.5 * cos,
      m01: -0.5 * sin,
      m02: 0.5,
      m10: 0.5 * sin,
      m11: 0.5 * cos,
      m12: 0.5,
    },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function diamondGradientPaint(stops: readonly FigGradientStop[]): FigPaint {
  return {
    type: "GRADIENT_DIAMOND",
    stops,
    transform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 0.5, m12: 0.5 },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function dropShadowEffect(opts: {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly color: FigColor;
}): FigEffect {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color: opts.color,
    offset: { x: opts.offsetX, y: opts.offsetY },
    radius: opts.radius,
    blendMode: "NORMAL",
  };
}

// =============================================================================
// Frame builder
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
};

type AddedFrame = { readonly doc: FigDesignDocument; readonly frameId: FigNodeId };

function addFrame(
  doc: FigDesignDocument,
  ctx: Ctx,
  opts: {
    readonly parentId: FigNodeId | null;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly background: FigColor;
    readonly clipsContent?: boolean;
  },
): AddedFrame {
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId: opts.parentId,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: [solidPaint(opts.background)],
      clipsContent: opts.clipsContent ?? true,
    },
  });
  return { doc: r.doc, frameId: r.nodeId };
}

// =============================================================================
// Fixture builders
// =============================================================================

type Args = {
  readonly doc: FigDesignDocument;
  readonly ctx: Ctx;
  readonly x: number;
  readonly y: number;
};
type Result = { readonly doc: FigDesignDocument };

function addAngularGradientBasic({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "angular-gradient-basic", x, y, width: 160, height: 160, background: WHITE });
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ELLIPSE",
      name: "angular-circle",
      x: 20,
      y: 20,
      width: 120,
      height: 120,
      fills: [angularGradientPaint([
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 0.33, color: { r: 0, g: 1, b: 0, a: 1 } },
        { position: 0.67, color: { r: 0, g: 0, b: 1, a: 1 } },
        { position: 1, color: { r: 1, g: 0, b: 0, a: 1 } },
      ])],
    },
  });
  return { doc: shape.doc };
}

function addAngularGradientRect({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "angular-gradient-rect", x, y, width: 200, height: 140, background: WHITE });
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "angular-rounded",
      x: 20,
      y: 20,
      width: 160,
      height: 100,
      cornerRadius: 16,
      fills: [angularGradientPaint(
        [
          { position: 0, color: { r: 0.9, g: 0.2, b: 0.5, a: 1 } },
          { position: 0.5, color: { r: 0.2, g: 0.5, b: 0.9, a: 1 } },
          { position: 1, color: { r: 0.9, g: 0.2, b: 0.5, a: 1 } },
        ],
        45,
      )],
    },
  });
  return { doc: shape.doc };
}

function addDiamondGradient({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "diamond-gradient", x, y, width: 160, height: 160, background: WHITE });
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "diamond-rect",
      x: 20,
      y: 20,
      width: 120,
      height: 120,
      cornerRadius: 8,
      fills: [diamondGradientPaint([
        { position: 0, color: { r: 1, g: 0.8, b: 0.2, a: 1 } },
        { position: 1, color: { r: 0.8, g: 0.2, b: 0.1, a: 1 } },
      ])],
    },
  });
  return { doc: shape.doc };
}

function addMultiFillSolid({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "multi-fill-solid", x, y, width: 160, height: 120, background: WHITE });
  // Two-layer fill — Figma stacks paints bottom-to-top in the fills
  // array; the upper paint with reduced opacity tints the lower one.
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "multi-solid",
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      cornerRadius: 12,
      fills: [
        solidPaint({ r: 0.2, g: 0.4, b: 0.9, a: 1 }), // bottom: blue
        solidPaint({ r: 0.9, g: 0.2, b: 0.2, a: 1 }, 0.5), // top: semi-transparent red
      ],
    },
  });
  return { doc: shape.doc };
}

function addMultiFillGradient({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "multi-fill-gradient", x, y, width: 200, height: 140, background: LIGHT_GRAY });
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "multi-gradient",
      x: 20,
      y: 20,
      width: 160,
      height: 100,
      cornerRadius: 10,
      fills: [
        solidPaint({ r: 0.1, g: 0.1, b: 0.3, a: 1 }), // bottom: dark
        linearGradientPaint(135, [
          { position: 0, color: { r: 1, g: 0.5, b: 0, a: 0.7 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
        ]),
      ],
    },
  });
  return { doc: shape.doc };
}

function addMaskBasic({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "mask-basic", x, y, width: 160, height: 160, background: WHITE });
  const inner = addFrame(f.doc, ctx, {
    parentId: f.frameId,
    name: "mask-group",
    x: 20,
    y: 20,
    width: 120,
    height: 120,
    background: WHITE,
    clipsContent: false,
  });
  // The mask shape clips the next sibling. `mask: true` is the
  // FigDesignNode-level flag that document-to-tree projects onto
  // the Kiwi `mask` field.
  const maskShape = addNode({
    state: ctx.state,
    doc: inner.doc,
    pageId: ctx.pageId,
    parentId: inner.frameId,
    spec: {
      type: "ELLIPSE",
      name: "mask-circle",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      fills: [solidPaint(WHITE)],
    },
  });
  const masked = updateNode({
    doc: maskShape.doc,
    pageId: ctx.pageId,
    nodeId: maskShape.nodeId,
    updater: (n) => ({ ...n, mask: true }),
  });
  const content = addNode({
    state: ctx.state,
    doc: masked,
    pageId: ctx.pageId,
    parentId: inner.frameId,
    spec: {
      type: "RECTANGLE",
      name: "masked-content",
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      fills: [linearGradientPaint(45, [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ])],
    },
  });
  return { doc: content.doc };
}

function addMaskRounded({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "mask-rounded", x, y, width: 200, height: 140, background: LIGHT_GRAY });
  const inner = addFrame(f.doc, ctx, {
    parentId: f.frameId,
    name: "mask-group",
    x: 20,
    y: 20,
    width: 160,
    height: 100,
    background: WHITE,
    clipsContent: false,
  });
  const maskShape = addNode({
    state: ctx.state,
    doc: inner.doc,
    pageId: ctx.pageId,
    parentId: inner.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "mask-shape",
      x: 0,
      y: 0,
      width: 160,
      height: 100,
      cornerRadius: 20,
      fills: [solidPaint(WHITE)],
    },
  });
  const masked = updateNode({
    doc: maskShape.doc,
    pageId: ctx.pageId,
    nodeId: maskShape.nodeId,
    updater: (n) => ({ ...n, mask: true }),
  });
  const content = addNode({
    state: ctx.state,
    doc: masked,
    pageId: ctx.pageId,
    parentId: inner.frameId,
    spec: {
      type: "RECTANGLE",
      name: "masked-gradient",
      x: -20,
      y: -20,
      width: 200,
      height: 140,
      fills: [radialGradientPaint([
        { position: 0, color: { r: 1, g: 0.8, b: 0, a: 1 } },
        { position: 1, color: { r: 0.5, g: 0, b: 0.5, a: 1 } },
      ])],
    },
  });
  return { doc: content.doc };
}

function addAngularGradientWithEffect({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, { parentId: null, name: "angular-gradient-effect", x, y, width: 180, height: 180, background: WHITE });
  const shape = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "angular-shadowed",
      x: 30,
      y: 30,
      width: 120,
      height: 120,
      cornerRadius: 20,
      fills: [angularGradientPaint([
        { position: 0, color: { r: 1, g: 0.3, b: 0.3, a: 1 } },
        { position: 0.25, color: { r: 1, g: 0.8, b: 0.2, a: 1 } },
        { position: 0.5, color: { r: 0.2, g: 0.8, b: 0.5, a: 1 } },
        { position: 0.75, color: { r: 0.3, g: 0.3, b: 1, a: 1 } },
        { position: 1, color: { r: 1, g: 0.3, b: 0.3, a: 1 } },
      ])],
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 4, radius: 12, color: { r: 0, g: 0, b: 0, a: 0.2 } })],
    },
  });
  return { doc: shape.doc };
}

// =============================================================================
// Main
// =============================================================================

async function generate(): Promise<void> {
  console.log("Generating advanced paint fixtures...\n");

  const empty = createEmptyFigDesignDocument("PaintAdvanced");
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
  const COL_WIDTH = 240;
  const ROW_HEIGHT = 200;
  const MARGIN = 50;

  type Builder = (args: Args) => Result;
  const builders: { name: string; fn: Builder }[] = [
    { name: "Angular gradient basic", fn: addAngularGradientBasic },
    { name: "Angular gradient rect", fn: addAngularGradientRect },
    { name: "Diamond gradient", fn: addDiamondGradient },
    { name: "Multi-fill solid", fn: addMultiFillSolid },
    { name: "Multi-fill gradient", fn: addMultiFillGradient },
    { name: "Mask basic (circle)", fn: addMaskBasic },
    { name: "Mask rounded rect", fn: addMaskRounded },
    { name: "Angular gradient + effect", fn: addAngularGradientWithEffect },
  ];

  const finalDoc = builders.reduce<FigDesignDocument>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = MARGIN + col * COL_WIDTH;
    const y = MARGIN + row * ROW_HEIGHT;
    return b.fn({ doc: acc, ctx, x, y }).doc;
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
  console.log("Frame list:");
  for (const b of builders) {
    console.log(`  - ${b.name}`);
  }
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
