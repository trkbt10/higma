#!/usr/bin/env bun
/**
 * @file Generate IMAGE fill fixture .fig file
 *
 * Tests image fill rendering:
 * - Basic image fill on rectangle (FILL)
 * - Image fill with drop shadow
 * - Image fill on circle (avatar pattern)
 * - Image fill with corner radius
 * - Solid + IMAGE multi-fill (stacked)
 * - STRETCH with identity transform (sanity branch for the convert layer)
 * - STRETCH + non-identity imageTransform — the wire-format spelling of the
 *   Figma editor's "Crop" UI (the binary `ImageScaleMode` enum has no CROP
 *   value, so a non-identity image transform on a STRETCH paint is what the
 *   editor actually writes when the user picks Crop and re-positions the
 *   image). The convert layer normalises this to scaleMode "CROP" so the
 *   SVG/WebGL renderers can honour the transform instead of plain-stretching
 *   the image into the element.
 * - Solid + STRETCH+transform image fill where part of the cropped image
 *   falls outside the element so the backdrop solid shows through (the
 *   `clipTransparent` path in the WebGL CROP branch).
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
  addImageToFigDocumentContext,
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { figImageHashHexToBytes } from "@higma-document-models/fig/domain";
import { BLEND_MODE_VALUES, EFFECT_TYPE_VALUES, PAINT_TYPE_VALUES, SCALE_MODE_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type {
  FigColor,
  FigEffect,
  FigImageScaleMode,
  FigImageTransform,
  FigPaint,
} from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/image-fill");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "image-fill.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };

function solidPaint(color: FigColor, opacity = 1): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function imagePaint(imageHashHex: string, opacity = 1): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    image: { hash: figImageHashHexToBytes(imageHashHex) },
    imageScaleMode: { value: SCALE_MODE_VALUES.FILL, name: "FILL" },
    opacity,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

/**
 * Image paint with an explicit `scaleMode` / `imageTransform` pair.
 *
 * Used to exercise the STRETCH+transform → CROP path: the binary Kiwi
 * `ImageScaleMode` enum has no CROP value, so the Figma editor records a
 * user-positioned Crop by leaving `imageScaleMode = STRETCH` and writing
 * the placement into `paint.transform`. Passing `scaleMode: "STRETCH"`
 * plus a non-identity `imageTransform` here reproduces that wire-format
 * spelling. The 6 components map element-uv (0..1) → image-uv (0..1)
 * via `image_uv = M · element_uv`, the same convention the renderer's
 * `computeImageUV` CROP branch consumes.
 */
function imagePaintWithTransform(
  imageHashHex: string,
  scaleMode: FigImageScaleMode,
  imageTransform: FigImageTransform,
  opacity = 1,
): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.IMAGE, name: "IMAGE" },
    image: { hash: figImageHashHexToBytes(imageHashHex) },
    imageScaleMode: { value: SCALE_MODE_VALUES[scaleMode], name: scaleMode },
    transform: imageTransform,
    opacity,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function dropShadow(ox: number, oy: number, radius: number, color: FigColor): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
    visible: true,
    color,
    offset: { x: ox, y: oy },
    radius,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
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
  readonly pageGuid: FigGuid;
  readonly imageHashHex: string;
};

function addFrame(
  ctx: Ctx,
  context: FigDocumentContext,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: FigColor,
): { context: FigDocumentContext; frameId: FigGuid } {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid: ctx.pageGuid,
    parentGuid: null,
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
  return { context: r.context, frameId: r.nodeGuid };
}

type Args = {
  readonly context: FigDocumentContext;
  readonly ctx: Ctx;
  readonly frameX: number;
  readonly frameY: number;
};

function addImageFillBasic({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-basic", frameX, frameY, 160, 120, WHITE);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-rect",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [imagePaint(ctx.imageHashHex)],
    },
  }).context;
}

function addImageFillWithShadow({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-shadow", frameX, frameY, 180, 140, LIGHT_GRAY);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-shadowed",
      x: 30, y: 30, width: 120, height: 80,
      cornerRadius: 12,
      fills: [imagePaint(ctx.imageHashHex)],
      effects: [dropShadow(0, 4, 8, { r: 0, g: 0, b: 0, a: 0.25 })],
    },
  }).context;
}

function addImageFillCircle({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-circle", frameX, frameY, 120, 120, WHITE);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ELLIPSE",
      name: "image-avatar",
      x: 20, y: 20, width: 80, height: 80,
      fills: [imagePaint(ctx.imageHashHex)],
    },
  }).context;
}

function addImageFillMulti({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-multi", frameX, frameY, 160, 120, LIGHT_GRAY);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "solid-plus-image",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [
        solidPaint({ r: 0.2, g: 0.3, b: 0.8, a: 1 }),
        imagePaint(ctx.imageHashHex, 0.6),
      ],
    },
  }).context;
}

/**
 * STRETCH with an identity `imageTransform`.
 *
 * Pins the "STRETCH + identity transform stays STRETCH" branch of the
 * convert layer's `resolveImageScaleMode`: a non-identity transform on a
 * STRETCH paint means the user picked Crop in the editor, so we must only
 * promote to CROP when the transform actually carries placement data.
 * Having an identity-transform STRETCH frame next to the CROP frames keeps
 * the regression honest — flipping the predicate would still pass any
 * test that only sees one of the two cases.
 */
function addImageFillStretch({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-stretch", frameX, frameY, 160, 120, WHITE);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-stretch",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [
        imagePaintWithTransform(ctx.imageHashHex, "STRETCH", {
          m00: 1, m01: 0, m02: 0,
          m10: 0, m11: 1, m12: 0,
        }),
      ],
    },
  }).context;
}

/**
 * STRETCH + non-identity `imageTransform` — Figma's wire-format spelling
 * of the editor's "Crop" mode. The matrix sends element-uv (0..1) into
 * image-uv (0..1) per `image_uv = M · element_uv`; with the values
 * below, element corners (0,0) and (1,1) sample image-uv (0.25,0.25)
 * and (0.75,0.75), i.e. only the centre half of the source image is
 * visible — stretched up to fill the rectangle. No element pixel maps
 * outside the image, so this is the "covered" CROP case (no backdrop
 * bleed-through).
 */
function addImageFillCrop({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-crop", frameX, frameY, 160, 120, WHITE);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "image-crop",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [
        imagePaintWithTransform(ctx.imageHashHex, "STRETCH", {
          m00: 0.5, m01: 0, m02: 0.25,
          m10: 0, m11: 0.5, m12: 0.25,
        }),
      ],
    },
  }).context;
}

/**
 * STRETCH + non-identity `imageTransform` where the cropped image does
 * not cover the whole element: m00 = m11 = 2 with m02 = m12 = -0.5
 * means element-uv (0,0)..(1,1) maps to image-uv (-0.5,-0.5)..(1.5,1.5),
 * so the image sits centred at half size and the four corners of the
 * rectangle sample outside the source. The renderer must treat those
 * out-of-image samples as transparent (the `clipTransparent: true` arm
 * of the CROP branch) so the solid paint stacked underneath shows
 * through — visually a portrait-on-coloured-card pattern.
 */
function addImageFillCropOffset({ context, ctx, frameX, frameY }: Args): FigDocumentContext {
  const f = addFrame(ctx, context, "image-fill-crop-offset", frameX, frameY, 160, 120, LIGHT_GRAY);
  return addNode({
    state: ctx.state,
    context: f.context,
    pageGuid: ctx.pageGuid,
    parentGuid: f.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "solid-plus-crop",
      x: 20, y: 20, width: 120, height: 80,
      cornerRadius: 8,
      fills: [
        solidPaint({ r: 0.2, g: 0.3, b: 0.8, a: 1 }),
        imagePaintWithTransform(ctx.imageHashHex, "STRETCH", {
          m00: 2, m01: 0, m02: -0.5,
          m10: 0, m11: 2, m12: -0.5,
        }),
      ],
    },
  }).context;
}

async function generateImageFillFixtures(): Promise<void> {
  console.log("Generating image fill fixtures...\n");

  const empty = createEmptyFigDocument("ImageFill");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "ImageFill").guid;
  const contextWithInternal = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const pngBytes = createCheckerboardPng();
  const imageHashHex = await computeSha1Hex(pngBytes);
  const contextWithImage = addImageToFigDocumentContext({
    context: contextWithInternal,
    image: {
    ref: imageHashHex,
    data: pngBytes,
    mimeType: "image/png",
    },
  });

  const ctx: Ctx = { state, pageGuid, imageHashHex };

  const GRID_COLS = 4;
  const COL_WIDTH = 220;
  const ROW_HEIGHT = 180;
  const MARGIN = 50;

  type Builder = (args: Args) => FigDocumentContext;

  const builders: { name: string; fn: Builder }[] = [
    { name: "Image fill basic", fn: addImageFillBasic },
    { name: "Image fill + shadow", fn: addImageFillWithShadow },
    { name: "Image fill circle", fn: addImageFillCircle },
    { name: "Image fill multi-layer", fn: addImageFillMulti },
    { name: "Image fill stretch (identity transform)", fn: addImageFillStretch },
    { name: "Image fill crop (STRETCH + transform)", fn: addImageFillCrop },
    { name: "Image fill crop with backdrop bleed-through", fn: addImageFillCropOffset },
  ];

  const finalContext = builders.reduce<FigDocumentContext>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = MARGIN + col * COL_WIDTH;
    const y = MARGIN + row * ROW_HEIGHT;
    return b.fn({ context: acc, ctx, frameX: x, frameY: y });
  }, contextWithImage);

  for (const dir of [OUTPUT_DIR, path.join(OUTPUT_DIR, "actual"), path.join(OUTPUT_DIR, "snapshots")]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const exported = await exportFig(finalContext);
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
