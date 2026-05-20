#!/usr/bin/env bun
/**
 * @file Generate text WebGL fixture .fig file with glyph outlines
 *
 * Creates a .fig file with focused text test cases. Each text node includes
 * derivedTextData with glyph outline blobs so the renderer produces <path>
 * elements instead of <text> elements (matching Figma's SVG export).
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-text-webgl-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import {
  addNode,
  addPage,
  addBlobToFigDocumentContext,
  createEmptyFigDocument,
  exportFig,
  updateNode,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type {
  FigColor,
  FigDerivedGlyph,
  FigPaint,
} from "@higma-document-models/fig/types";
import { TEXT_ALIGN_H_VALUES } from "@higma-document-models/fig/constants";
import {
  generateTextGlyphs,
  generateMultilineTextGlyphs,
  computeBaselineY,
  computeAutoLineHeight,
  type GlyphGenResult,
} from "./glyph-blob-generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/text-webgl");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "text-webgl.fig");

const FONT_DIR = path.resolve(process.cwd(), "node_modules/@fontsource/inter/files");
const INTER_REGULAR = path.join(FONT_DIR, "inter-latin-400-normal.woff");
const INTER_BOLD = path.join(FONT_DIR, "inter-latin-700-normal.woff");

// =============================================================================
// Shared construction
// =============================================================================

const white: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const black: FigColor = { r: 0, g: 0, b: 0, a: 1 };
const lightGray: FigColor = { r: 0.94, g: 0.94, b: 0.94, a: 1 };

function rgb(r: number, g: number, b: number): FigColor {
  return { r, g, b, a: 1 };
}

function solidPaint(color: FigColor): FigPaint {
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color, opacity: 1, visible: true, blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" } };
}

type Ctx = {
  readonly state: FigBuilderState;
};

type TextOpts = {
  readonly parentGuid: FigGuid;
  readonly name: string;
  readonly text: string;
  readonly font: { readonly family: string; readonly style: string };
  readonly fontSize: number;
  readonly color: FigColor;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alignH?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  readonly glyphs: GlyphGenResult;
};

/**
 * Add a TEXT node with glyph outline blobs (derivedTextData).
 *
 * NodeSpec does not cover `derivedTextData`, so this script writes the
 * Kiwi TEXT node field through `updateNode` after node creation.
 *
 * Blob handling: each blob is registered on the document via
 * `addBlobToFigDocumentContext`; the returned global index is patched into every glyph
 * record's `commandsBlob` field so the eventual on-disk
 * `derivedTextData.glyphs[i].commandsBlob` points at the correct
 * `context.blobs[]` entry.
 */
type TextAlignHName = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

function buildTextAlignHorizontal(
  alignH: TextAlignHName | undefined,
): { value: number; name: TextAlignHName } | undefined {
  if (!alignH) {return undefined;}
  return { value: TEXT_ALIGN_H_VALUES[alignH], name: alignH };
}

function addTextWithGlyphs(
  context: FigDocumentContext,
  pageGuid: FigGuid,
  ctx: Ctx,
  opts: TextOpts,
): FigDocumentContext {
  // Add each glyph blob to the document and capture the remapped index.
  const blobAddResult = opts.glyphs.blobs.reduce<{ readonly context: FigDocumentContext; readonly indices: readonly number[] }>(
    (acc, b) => {
      const result = addBlobToFigDocumentContext({ context: acc.context, blob: b });
      return { context: result.context, indices: [...acc.indices, result.blobIndex] };
    },
    { context, indices: [] },
  );
  const remappedGlyphs: readonly FigDerivedGlyph[] = opts.glyphs.glyphs.map((g) => ({
    ...g,
    commandsBlob: blobAddResult.indices[g.commandsBlob] ?? g.commandsBlob,
  }));

  const r = addNode({
    state: ctx.state,
    context: blobAddResult.context,
    pageGuid,
    parentGuid: opts.parentGuid,
    spec: {
      type: "TEXT",
      name: opts.name,
      characters: opts.text,
      fontFamily: opts.font.family,
      fontStyle: opts.font.style,
      fontSize: opts.fontSize,
      fills: [solidPaint(opts.color)],
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      textAlignHorizontal: buildTextAlignHorizontal(opts.alignH),
    },
  });
  return updateNode({
    context: r.context,
    nodeGuid: r.nodeGuid,
    update: (n) => ({
      ...n,
      derivedTextData: {
        layoutSize: opts.glyphs.layoutSize,
        baselines: opts.glyphs.baselines,
        glyphs: remappedGlyphs,
      },
    }),
  });
}

// =============================================================================
// Main
// =============================================================================

type FrameOpts = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly background?: FigColor;
  readonly clipsContent?: boolean;
};

function addFrame(
  context: FigDocumentContext,
  pageGuid: FigGuid,
  ctx: Ctx,
  parentGuid: FigGuid | null,
  opts: FrameOpts,
): { readonly context: FigDocumentContext; readonly id: FigGuid } {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid,
    parentGuid,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: [solidPaint(opts.background ?? white)],
      clipsContent: opts.clipsContent ?? true,
    },
  });
  return { context: r.context, id: r.nodeGuid };
}

async function generate(): Promise<void> {
  console.log("Generating text WebGL fixtures with glyph outlines...");

  if (!fs.existsSync(INTER_REGULAR)) {
    throw new Error(`Inter Regular font not found: ${INTER_REGULAR}`);
  }
  if (!fs.existsSync(INTER_BOLD)) {
    throw new Error(`Inter Bold font not found: ${INTER_BOLD}`);
  }
  // opentype.loadSync was deprecated; parse the buffer directly.
  // `parse` returns the Font synchronously, matching the legacy
  // loadSync surface without the deprecation warning.
  const interRegular = opentype.parse(fs.readFileSync(INTER_REGULAR).buffer as ArrayBuffer);
  const interBold = opentype.parse(fs.readFileSync(INTER_BOLD).buffer as ArrayBuffer);
  console.log(`  Inter Regular: unitsPerEm=${interRegular.unitsPerEm}`);
  console.log(`  Inter Bold: unitsPerEm=${interBold.unitsPerEm}`);

  const empty = createEmptyFigDocument("Text WebGL");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const ctx: Ctx = { state };
  const pageGuid = requireCanvas(empty.document, "Text WebGL").guid;
  const docInit = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  // Grid layout — frame index tracked via a ref object so the
  // surrounding builders stay closure-free and `let`-free.
  const GRID_COLS = 4;
  const GRID_GAP = 30;
  const MARGIN = 50;
  const COL_WIDTH = 220 + GRID_GAP;
  const ROW_HEIGHT = 220 + GRID_GAP;
  function gridPos(index: number): { x: number; y: number } {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    return { x: MARGIN + col * COL_WIDTH, y: MARGIN + row * ROW_HEIGHT };
  }

  // Each builder produces an updated document. We thread the context
  // through `reduce` so no top-level `let` rebinds are needed.
  type Builder = (acc: FigDocumentContext, pos: { x: number; y: number }) => FigDocumentContext;

  const builders: readonly Builder[] = [
    // text-basic
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-basic", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 16;
      const glyphs = generateTextGlyphs({
        text: "Hello World",
        font: interRegular,
        fontSize,
        baselineX: 0,
        baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "hello", text: "Hello World",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        x: 10, y: 15, width: 180, height: 30, glyphs,
      });
    },
    // text-bold
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-bold", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 16;
      const glyphs = generateTextGlyphs({
        text: "Bold Text",
        font: interBold,
        fontSize,
        baselineX: 0,
        baselineY: computeBaselineY(interBold, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "bold-text", text: "Bold Text",
        font: { family: "Inter", style: "Bold" }, fontSize, color: black,
        x: 10, y: 15, width: 180, height: 30, glyphs,
      });
    },
    // text-small
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-small", x: pos.x, y: pos.y, width: 200, height: 40 });
      const fontSize = 10;
      const glyphs = generateTextGlyphs({
        text: "Small text at 10px",
        font: interRegular,
        fontSize,
        baselineX: 0,
        baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "small-text", text: "Small text at 10px",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        x: 10, y: 10, width: 180, height: 20, glyphs,
      });
    },
    // text-large
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-large", x: pos.x, y: pos.y, width: 200, height: 80 });
      const fontSize = 48;
      const glyphs = generateTextGlyphs({
        text: "Big",
        font: interBold,
        fontSize,
        baselineX: 0,
        baselineY: computeBaselineY(interBold, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "large-text", text: "Big",
        font: { family: "Inter", style: "Bold" }, fontSize, color: black,
        x: 10, y: 10, width: 180, height: 60, glyphs,
      });
    },
    // text-multiline
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-multiline", x: pos.x, y: pos.y, width: 200, height: 100 });
      const fontSize = 14;
      const text = "Line one\nLine two\nLine three";
      const lines = text.split("\n");
      const glyphs = generateMultilineTextGlyphs({
        lines,
        font: interRegular,
        fontSize,
        baselineX: 0,
        firstBaselineY: computeBaselineY(interRegular, fontSize),
        lineHeight: computeAutoLineHeight(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "multiline", text,
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        x: 10, y: 10, width: 180, height: 80, glyphs,
      });
    },
    // text-colors — three colored words side by side
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-colors", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 14;
      const baselineY = computeBaselineY(interBold, fontSize);
      const entries: readonly { text: string; color: FigColor; posX: number }[] = [
        { text: "Red", color: rgb(0.9, 0.1, 0.1), posX: 10 },
        { text: "Green", color: rgb(0.1, 0.7, 0.1), posX: 70 },
        { text: "Blue", color: rgb(0.1, 0.1, 0.9), posX: 130 },
      ];
      return entries.reduce<FigDocumentContext>((innerAcc, entry) => {
        const g = generateTextGlyphs({
          text: entry.text, font: interBold, fontSize, baselineX: 0, baselineY,
        });
        return addTextWithGlyphs(innerAcc, pageGuid, ctx, {
          parentGuid: f.id, name: entry.text.toLowerCase(), text: entry.text,
          font: { family: "Inter", style: "Bold" }, fontSize, color: entry.color,
          x: entry.posX, y: 15, width: 50, height: 30, glyphs: g,
        });
      }, f.context);
    },
    // text-align-left
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-align-left", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 14;
      const glyphs = generateTextGlyphs({
        text: "Left aligned", font: interRegular, fontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "left-aligned", text: "Left aligned",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        alignH: "LEFT",
        x: 10, y: 15, width: 180, height: 30, glyphs,
      });
    },
    // text-align-center
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-align-center", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 14;
      const glyphs = generateTextGlyphs({
        text: "Center aligned", font: interRegular, fontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "center-aligned", text: "Center aligned",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        alignH: "CENTER",
        x: 10, y: 15, width: 180, height: 30, glyphs,
      });
    },
    // text-align-right
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-align-right", x: pos.x, y: pos.y, width: 200, height: 60 });
      const fontSize = 14;
      const glyphs = generateTextGlyphs({
        text: "Right aligned", font: interRegular, fontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(f.context, pageGuid, ctx, {
        parentGuid: f.id, name: "right-aligned", text: "Right aligned",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        alignH: "RIGHT",
        x: 10, y: 15, width: 180, height: 30, glyphs,
      });
    },
    // text-in-clip
    (acc, pos) => {
      const outer = addFrame(acc, pageGuid, ctx, null, { name: "text-in-clip", x: pos.x, y: pos.y, width: 200, height: 80 });
      const clip = addFrame(outer.context, pageGuid, ctx, outer.id, {
        name: "clip", x: 20, y: 15, width: 160, height: 50, background: lightGray, clipsContent: true,
      });
      const fontSize = 14;
      const glyphs = generateTextGlyphs({
        text: "Clipped text content here", font: interRegular, fontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(clip.context, pageGuid, ctx, {
        parentGuid: clip.id, name: "clipped-text", text: "Clipped text content here",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        x: 5, y: 10, width: 200, height: 30, glyphs,
      });
    },
    // text-in-nested-clip
    (acc, pos) => {
      const outer = addFrame(acc, pageGuid, ctx, null, { name: "text-in-nested-clip", x: pos.x, y: pos.y, width: 200, height: 100 });
      const inner = addFrame(outer.context, pageGuid, ctx, outer.id, {
        name: "inner-clip", x: 20, y: 15, width: 160, height: 70, background: lightGray, clipsContent: true,
      });
      const deep = addFrame(inner.context, pageGuid, ctx, inner.id, {
        name: "deep-clip", x: 15, y: 15, width: 130, height: 40, clipsContent: true,
      });
      const fontSize = 14;
      const glyphs = generateTextGlyphs({
        text: "Nested clip text", font: interRegular, fontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, fontSize),
      });
      return addTextWithGlyphs(deep.context, pageGuid, ctx, {
        parentGuid: deep.id, name: "nested-text", text: "Nested clip text",
        font: { family: "Inter", style: "Regular" }, fontSize, color: black,
        x: 5, y: 5, width: 120, height: 30, glyphs,
      });
    },
    // text-with-shape — card title + subtitle with background rect and avatar circle
    (acc, pos) => {
      const f = addFrame(acc, pageGuid, ctx, null, { name: "text-with-shape", x: pos.x, y: pos.y, width: 200, height: 100 });
      const bg = addNode({
        state: ctx.state,
        context: f.context,
        pageGuid,
        parentGuid: f.id,
        spec: {
          type: "ROUNDED_RECTANGLE", name: "bg-card",
          x: 10, y: 10, width: 180, height: 80,
          fills: [solidPaint(rgb(0.93, 0.93, 0.98))],
          cornerRadius: 8,
        },
      });
      const avatar = addNode({
        state: ctx.state,
        context: bg.context,
        pageGuid,
        parentGuid: f.id,
        spec: {
          type: "ELLIPSE", name: "avatar",
          x: 20, y: 30, width: 40, height: 40,
          fills: [solidPaint(rgb(0.3, 0.5, 0.9))],
        },
      });
      const titleFontSize = 16;
      const titleGlyphs = generateTextGlyphs({
        text: "Card Title", font: interBold, fontSize: titleFontSize,
        baselineX: 0, baselineY: computeBaselineY(interBold, titleFontSize),
      });
      const contextWithTitle = addTextWithGlyphs(avatar.context, pageGuid, ctx, {
        parentGuid: f.id, name: "title", text: "Card Title",
        font: { family: "Inter", style: "Bold" }, fontSize: titleFontSize, color: black,
        x: 75, y: 25, width: 110, height: 24, glyphs: titleGlyphs,
      });
      const subFontSize = 12;
      const subGlyphs = generateTextGlyphs({
        text: "Description text", font: interRegular, fontSize: subFontSize,
        baselineX: 0, baselineY: computeBaselineY(interRegular, subFontSize),
      });
      return addTextWithGlyphs(contextWithTitle, pageGuid, ctx, {
        parentGuid: f.id, name: "subtitle", text: "Description text",
        font: { family: "Inter", style: "Regular" }, fontSize: subFontSize, color: rgb(0.4, 0.4, 0.4),
        x: 75, y: 55, width: 110, height: 20, glyphs: subGlyphs,
      });
    },
  ];

  const finalContext = builders.reduce<FigDocumentContext>(
    (acc, fn, index) => fn(acc, gridPos(index)),
    docInit,
  );

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const actualDir = path.join(OUTPUT_DIR, "actual");
  if (!fs.existsSync(actualDir)) {
    fs.mkdirSync(actualDir, { recursive: true });
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Frames: ${builders.length}`);
  const names = [
    "text-basic", "text-bold", "text-small", "text-large", "text-multiline",
    "text-colors", "text-align-left", "text-align-center", "text-align-right",
    "text-in-clip", "text-in-nested-clip", "text-with-shape",
  ];
  console.log(`\nFrame list:`);
  for (const name of names) {
    console.log(`  - ${name}`);
  }
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
