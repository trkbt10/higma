#!/usr/bin/env bun
/**
 * @file Generate effect fixture .fig file
 *
 * Creates a .fig file with effect examples for testing:
 * - Drop shadow (basic, offset, colored, multiple)
 * - Inner shadow
 * - Layer blur
 * - Opacity
 * - Blend modes
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-effect-fixtures.ts
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
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigEffect, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/effects");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "effects.fig");

function solidPaint(color: FigColor, opacity = 1): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity,
    visible: true,
    blendMode: "NORMAL",
  };
}

function dropShadow(
  ox: number, oy: number, radius: number,
  r = 0, g = 0, b = 0, a = 0.25,
): FigEffect {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color: { r, g, b, a },
    offset: { x: ox, y: oy },
    radius,
    blendMode: "NORMAL",
  };
}

function innerShadow(
  ox: number, oy: number, radius: number,
  r = 0, g = 0, b = 0, a = 0.25,
): FigEffect {
  return {
    type: "INNER_SHADOW",
    visible: true,
    color: { r, g, b, a },
    offset: { x: ox, y: oy },
    radius,
    blendMode: "NORMAL",
  };
}

function layerBlur(radius: number): FigEffect {
  return {
    type: "LAYER_BLUR",
    visible: true,
    radius,
  };
}

type EffectChild = {
  shape: "rect" | "ellipse";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  fill: { r: number; g: number; b: number };
  opacity?: number;
  effects?: readonly FigEffect[];
};

type EffectFrameData = {
  name: string;
  width: number;
  height: number;
  background: string;
  children: EffectChild[];
};

const EFFECT_FRAMES: EffectFrameData[] = [
  {
    name: "shadow-drop-basic",
    width: 120,
    height: 120,
    background: "#ffffff",
    children: [
      {
        shape: "rect",
        name: "box",
        x: 20, y: 20, width: 80, height: 80,
        cornerRadius: 8,
        fill: { r: 0.3, g: 0.5, b: 0.9 },
        effects: [dropShadow(0, 4, 8, 0, 0, 0, 0.25)],
      },
    ],
  },
  {
    name: "shadow-drop-offset",
    width: 140,
    height: 140,
    background: "#ffffff",
    children: [
      {
        shape: "rect",
        name: "box",
        x: 20, y: 20, width: 80, height: 80,
        cornerRadius: 8,
        fill: { r: 0.9, g: 0.5, b: 0.3 },
        effects: [dropShadow(10, 10, 4, 0, 0, 0, 0.3)],
      },
    ],
  },
  {
    name: "shadow-drop-color",
    width: 120,
    height: 120,
    background: "#f5f5f5",
    children: [
      {
        shape: "rect",
        name: "box",
        x: 20, y: 20, width: 80, height: 80,
        cornerRadius: 8,
        fill: { r: 1, g: 1, b: 1 },
        effects: [dropShadow(0, 4, 12, 0.5, 0, 0.8, 0.4)],
      },
    ],
  },
  {
    name: "shadow-drop-multi",
    width: 140,
    height: 140,
    background: "#ffffff",
    children: [
      {
        shape: "rect",
        name: "box",
        x: 30, y: 30, width: 80, height: 80,
        cornerRadius: 8,
        fill: { r: 0.2, g: 0.7, b: 0.4 },
        effects: [
          dropShadow(0, 2, 4, 0, 0, 0, 0.1),
          dropShadow(0, 8, 16, 0, 0, 0, 0.15),
        ],
      },
    ],
  },
  {
    name: "shadow-inner",
    width: 120,
    height: 120,
    background: "#ffffff",
    children: [
      {
        shape: "rect",
        name: "box",
        x: 20, y: 20, width: 80, height: 80,
        cornerRadius: 8,
        fill: { r: 0.9, g: 0.9, b: 0.9 },
        effects: [innerShadow(0, 2, 4, 0, 0, 0, 0.15)],
      },
    ],
  },
  {
    name: "blur-layer",
    width: 120,
    height: 120,
    background: "#ffffff",
    children: [
      {
        shape: "ellipse",
        name: "circle",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.9, g: 0.3, b: 0.3 },
        effects: [layerBlur(4)],
      },
    ],
  },
  {
    name: "opacity-50",
    width: 160,
    height: 100,
    background: "#dddddd",
    children: [
      { shape: "rect", name: "full", x: 15, y: 25, width: 50, height: 50, fill: { r: 0.2, g: 0.5, b: 0.9 } },
      {
        shape: "rect", name: "half",
        x: 95, y: 25, width: 50, height: 50,
        fill: { r: 0.2, g: 0.5, b: 0.9 },
        opacity: 0.5,
      },
    ],
  },
  {
    name: "effects-combined",
    width: 140,
    height: 140,
    background: "#ffffff",
    children: [
      {
        shape: "rect",
        name: "card",
        x: 20, y: 20, width: 100, height: 100,
        cornerRadius: 12,
        fill: { r: 1, g: 1, b: 1 },
        effects: [
          dropShadow(0, 4, 6, 0, 0, 0, 0.1),
          dropShadow(0, 12, 24, 0, 0, 0, 0.1),
          innerShadow(0, 1, 0, 1, 1, 1, 0.5),
        ],
      },
    ],
  },
  {
    name: "shadow-shapes",
    width: 280,
    height: 100,
    background: "#ffffff",
    children: [
      {
        shape: "rect", name: "rect",
        x: 20, y: 20, width: 60, height: 60,
        fill: { r: 0.9, g: 0.3, b: 0.3 },
        effects: [dropShadow(0, 4, 8)],
      },
      {
        shape: "rect", name: "rounded",
        x: 110, y: 20, width: 60, height: 60,
        cornerRadius: 12,
        fill: { r: 0.3, g: 0.7, b: 0.3 },
        effects: [dropShadow(0, 4, 8)],
      },
      {
        shape: "ellipse", name: "circle",
        x: 200, y: 20, width: 60, height: 60,
        fill: { r: 0.3, g: 0.5, b: 0.9 },
        effects: [dropShadow(0, 4, 8)],
      },
    ],
  },
];

function hexToColor(hex: string): FigColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0.9, g: 0.9, b: 0.9, a: 1 };
  }
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
    a: 1,
  };
}

function addChild(
  state: FigBuilderState,
  doc: FigDesignDocument,
  pageId: FigPageId,
  parentId: ReturnType<typeof addNode>["nodeId"],
  child: EffectChild,
): FigDesignDocument {
  const fill = solidPaint({ ...child.fill, a: 1 });
  if (child.shape === "rect") {
    return addNode({
      state,
      doc,
      pageId,
      parentId,
      spec: {
        type: "ROUNDED_RECTANGLE",
        name: child.name,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
        fills: [fill],
        cornerRadius: child.cornerRadius,
        opacity: child.opacity,
        effects: child.effects,
      },
    }).doc;
  }
  return addNode({
    state,
    doc,
    pageId,
    parentId,
    spec: {
      type: "ELLIPSE",
      name: child.name,
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
      fills: [fill],
      opacity: child.opacity,
      effects: child.effects,
    },
  }).doc;
}

async function generateEffectFixtures(): Promise<void> {
  console.log("Generating effect fixtures...");

  const empty = createEmptyFigDesignDocument("Document");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const doc0 = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  const GRID_COLS = 4;
  const GRID_GAP = 30;
  const MARGIN = 50;

  const finalDoc = EFFECT_FRAMES.reduce<FigDesignDocument>((acc, frameData, index) => {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const maxFrameWidth = 280;
    const maxFrameHeight = 150;
    const frameX = MARGIN + col * (maxFrameWidth + GRID_GAP);
    const frameY = MARGIN + row * (maxFrameHeight + GRID_GAP);
    const bgColor = hexToColor(frameData.background);

    const frameResult = addNode({
      state,
      doc: acc,
      pageId,
      parentId: null,
      spec: {
        type: "FRAME",
        name: frameData.name,
        x: frameX,
        y: frameY,
        width: frameData.width,
        height: frameData.height,
        fills: [solidPaint(bgColor)],
        clipsContent: true,
      },
    });

    return frameData.children.reduce<FigDesignDocument>(
      (innerAcc, child) => addChild(state, innerAcc, pageId, frameResult.nodeId, child),
      frameResult.doc,
    );
  }, doc0);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const actualDir = path.join(OUTPUT_DIR, "actual");
  if (!fs.existsSync(actualDir)) {
    fs.mkdirSync(actualDir, { recursive: true });
  }

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Frames: ${EFFECT_FRAMES.length}`);
  console.log(`\nFrame list:`);
  for (const frame of EFFECT_FRAMES) {
    console.log(`  - ${frame.name} (${frame.width}x${frame.height})`);
  }

  console.log(`\nEffects are now applied programmatically via the builder.`);

  console.log(`\nNext steps:`);
  console.log(`1. Open ${OUTPUT_FILE} in Figma to verify effects`);
  console.log(`2. Export each frame as SVG to ${actualDir}/`);
  console.log(`3. Run: npx vitest run packages/@higma-document-renderers/fig/spec/effects.spec.ts`);
}

generateEffectFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
