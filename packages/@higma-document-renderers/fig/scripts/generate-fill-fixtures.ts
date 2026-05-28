#!/usr/bin/env bun
/**
 * @file Generate fill/paint fixture .fig file
 *
 * Creates a .fig file with various fill examples for testing:
 * - Solid colors (various colors, opacity)
 * - Linear gradients (horizontal, vertical, diagonal, multi-stop)
 * - Radial gradients (centered, offset, elliptical)
 * - Stroke styles (caps, joins, dash patterns, alignment)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
  type PaintSpec,
  type SolidPaintSpec,
  type GradientPaintSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type {
  FigColor,
  FigGradientStop,
  FigNode,
} from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/fills");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "fills.fig");

function solidPaint(color: FigColor, opacity = 1): SolidPaintSpec {
  return { type: "SOLID", color, opacity, visible: true };
}

/**
 * Build a linear gradient paint. The transform matrix maps gradient
 * space → normalized object space (0..1, 0..1). `angleDeg=0` ⇒
 * left-to-right, `90` ⇒ top-to-bottom (Figma convention).
 */
function linearGradientPaint(angleDeg: number, stops: readonly FigGradientStop[]): GradientPaintSpec {
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
    stops,
    transform: { m00: dx, m01: -dy, m02: endX, m10: dy, m11: dx, m12: endY },
  };
}

/**
 * Build a radial gradient paint. Mirrors `radialParamsToTransform`
 * in `fig-file/paint/gradient-transform.ts`.
 */
function radialGradientPaint(
  centerX: number,
  centerY: number,
  radius: number,
  stops: readonly FigGradientStop[],
): GradientPaintSpec {
  return {
    type: "GRADIENT_RADIAL",
    opacity: 1,
    visible: true,
    stops,
    transform: { m00: radius, m01: 0, m02: centerX, m10: 0, m11: radius, m12: centerY },
  };
}

type FillChild = {
  shape: "rect" | "ellipse";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  fill?: PaintSpec;
  strokeData?: {
    color: { r: number; g: number; b: number };
    weight: number;
    cap?: "NONE" | "ROUND" | "SQUARE";
    join?: "MITER" | "BEVEL" | "ROUND";
    align?: "CENTER" | "INSIDE" | "OUTSIDE";
    dash?: number[];
  };
};

type FillFrameData = {
  name: string;
  width: number;
  height: number;
  background: string;
  children: FillChild[];
};

type FillStrokeData = NonNullable<FillChild["strokeData"]>;

const SOLID_RED: PaintSpec = solidPaint({ r: 0.9, g: 0.2, b: 0.2, a: 1 });
const SOLID_GREEN: PaintSpec = solidPaint({ r: 0.2, g: 0.8, b: 0.3, a: 1 });
const SOLID_BLUE: PaintSpec = solidPaint({ r: 0.2, g: 0.4, b: 0.9, a: 1 });
const SOLID_BLACK: PaintSpec = solidPaint({ r: 0, g: 0, b: 0, a: 1 });
const SOLID_WHITE: PaintSpec = solidPaint({ r: 1, g: 1, b: 1, a: 1 });
const SOLID_PURPLE: PaintSpec = solidPaint({ r: 0.5, g: 0.2, b: 0.8, a: 1 });
const SOLID_PURPLE_50: PaintSpec = solidPaint({ r: 0.5, g: 0.2, b: 0.8, a: 1 }, 0.5);
const SOLID_LIGHT_GRAY: PaintSpec = solidPaint({ r: 0.9, g: 0.9, b: 0.9, a: 1 });

const FILL_FRAMES: FillFrameData[] = [
  {
    name: "solid-colors", width: 260, height: 80, background: "#ffffff",
    children: [
      { shape: "rect", name: "red", x: 10, y: 15, width: 50, height: 50, fill: SOLID_RED },
      { shape: "rect", name: "green", x: 70, y: 15, width: 50, height: 50, fill: SOLID_GREEN },
      { shape: "rect", name: "blue", x: 130, y: 15, width: 50, height: 50, fill: SOLID_BLUE },
      { shape: "rect", name: "black", x: 190, y: 15, width: 25, height: 50, fill: SOLID_BLACK },
      {
        shape: "rect", name: "white",
        x: 225, y: 15, width: 25, height: 50,
        fill: SOLID_WHITE,
        strokeData: { color: { r: 0.8, g: 0.8, b: 0.8 }, weight: 1 },
      },
    ],
  },
  {
    name: "solid-opacity", width: 120, height: 80, background: "#dddddd",
    children: [
      { shape: "rect", name: "full", x: 10, y: 15, width: 40, height: 50, fill: SOLID_PURPLE },
      { shape: "rect", name: "half", x: 65, y: 15, width: 40, height: 50, fill: SOLID_PURPLE_50 },
    ],
  },
  {
    name: "gradient-linear-h", width: 120, height: 80, background: "#f5f5f5",
    children: [
      {
        shape: "rect", name: "linear-h",
        x: 10, y: 15, width: 100, height: 50,
        fill: linearGradientPaint(0, [
          { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "gradient-linear-v", width: 80, height: 120, background: "#f5f5f5",
    children: [
      {
        shape: "rect", name: "linear-v",
        x: 15, y: 10, width: 50, height: 100,
        fill: linearGradientPaint(90, [
          { color: { r: 0, g: 1, b: 0, a: 1 }, position: 0 },
          { color: { r: 1, g: 1, b: 0, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "gradient-linear-45", width: 100, height: 100, background: "#f5f5f5",
    children: [
      {
        shape: "rect", name: "linear-45",
        x: 10, y: 10, width: 80, height: 80,
        fill: linearGradientPaint(45, [
          { color: { r: 1, g: 0, b: 1, a: 1 }, position: 0 },
          { color: { r: 0, g: 1, b: 1, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "gradient-multi-stop", width: 220, height: 60, background: "#f5f5f5",
    children: [
      {
        shape: "rect", name: "rainbow",
        x: 10, y: 10, width: 200, height: 40,
        fill: linearGradientPaint(0, [
          { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
          { color: { r: 1, g: 1, b: 0, a: 1 }, position: 0.25 },
          { color: { r: 0, g: 1, b: 0, a: 1 }, position: 0.5 },
          { color: { r: 0, g: 1, b: 1, a: 1 }, position: 0.75 },
          { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "gradient-radial", width: 100, height: 100, background: "#f5f5f5",
    children: [
      {
        shape: "ellipse", name: "radial",
        x: 10, y: 10, width: 80, height: 80,
        fill: radialGradientPaint(0.5, 0.5, 0.5, [
          { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 },
          { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "gradient-radial-offset", width: 100, height: 100, background: "#f5f5f5",
    children: [
      {
        shape: "ellipse", name: "radial-offset",
        x: 10, y: 10, width: 80, height: 80,
        fill: radialGradientPaint(0.3, 0.3, 0.7, [
          { color: { r: 1, g: 0.8, b: 0, a: 1 }, position: 0 },
          { color: { r: 0.8, g: 0.2, b: 0, a: 1 }, position: 1 },
        ]),
      },
    ],
  },
  {
    name: "stroke-basic", width: 200, height: 80, background: "#ffffff",
    children: [
      {
        shape: "rect", name: "thin",
        x: 10, y: 15, width: 50, height: 50,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 1 },
      },
      {
        shape: "rect", name: "medium",
        x: 75, y: 15, width: 50, height: 50,
        strokeData: { color: { r: 0.2, g: 0.4, b: 0.8 }, weight: 3 },
      },
      {
        shape: "rect", name: "thick",
        x: 140, y: 15, width: 50, height: 50,
        strokeData: { color: { r: 0.8, g: 0.2, b: 0.2 }, weight: 6 },
      },
    ],
  },
  {
    name: "stroke-caps", width: 200, height: 60, background: "#ffffff",
    children: [
      {
        shape: "rect", name: "none-cap",
        x: 10, y: 20, width: 50, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, cap: "NONE" },
      },
      {
        shape: "rect", name: "round-cap",
        x: 75, y: 20, width: 50, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, cap: "ROUND" },
      },
      {
        shape: "rect", name: "square-cap",
        x: 140, y: 20, width: 50, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, cap: "SQUARE" },
      },
    ],
  },
  {
    name: "stroke-dash", width: 220, height: 100, background: "#ffffff",
    children: [
      {
        shape: "rect", name: "solid",
        x: 10, y: 10, width: 200, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 2 },
      },
      {
        shape: "rect", name: "dashed",
        x: 10, y: 40, width: 200, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 2, dash: [8, 4] },
      },
      {
        shape: "rect", name: "dotted",
        x: 10, y: 70, width: 200, height: 20,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 2, dash: [2, 4] },
      },
    ],
  },
  {
    name: "stroke-align", width: 200, height: 80, background: "#f0f0f0",
    children: [
      {
        shape: "rect", name: "center",
        x: 15, y: 15, width: 50, height: 50,
        fill: SOLID_LIGHT_GRAY,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, align: "CENTER" },
      },
      {
        shape: "rect", name: "inside",
        x: 80, y: 15, width: 50, height: 50,
        fill: SOLID_LIGHT_GRAY,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, align: "INSIDE" },
      },
      {
        shape: "rect", name: "outside",
        x: 145, y: 15, width: 50, height: 50,
        fill: SOLID_LIGHT_GRAY,
        strokeData: { color: { r: 0, g: 0, b: 0 }, weight: 4, align: "OUTSIDE" },
      },
    ],
  },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0.9, g: 0.9, b: 0.9 };
  }
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

function buildStrokeList(strokeData: FillChild["strokeData"]): PaintSpec[] {
  if (!strokeData) {return [];}
  return [solidPaint({ ...strokeData.color, a: 1 })];
}

function addFillChild(
  state: FigBuilderState,
  context: FigDocumentContext,
  pageGuid: FigGuid,
  parentGuid: ReturnType<typeof addNode>["nodeGuid"],
  child: FillChild,
): FigDocumentContext {
  const fills: PaintSpec[] = child.fill ? [child.fill] : [];
  const strokes: PaintSpec[] = buildStrokeList(child.strokeData);

  const type = child.shape === "rect" ? "ROUNDED_RECTANGLE" : "ELLIPSE";
  const r = addNode({
    state, context, pageGuid, parentGuid,
    spec: {
      visible: true,
      opacity: 1,
      type,
      name: child.name,
      x: child.x, y: child.y,
      width: child.width, height: child.height,
      fills,
      strokes,
      strokeWeight: child.strokeData?.weight,
      // The builder lifts these plain string names to their Kiwi
      // `value` entries inside `createNodeFromSpec`. This script no
      // longer mirrors the `STROKE_*_VALUES` tables.
      strokeCap: child.strokeData?.cap,
      strokeJoin: child.strokeData?.join,
      strokeAlign: child.strokeData?.align,
      strokeDashes: child.strokeData?.dash,
      cornerRadius: child.shape === "rect" ? child.cornerRadius : undefined,
    },
  });
  return r.context;
}

async function generateFillFixtures(): Promise<void> {
  console.log("Generating fill fixtures...");

  const empty = createEmptyFigDocument("Fills");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Fills").guid;
  // The original script omitted the Internal Only Canvas. Keep the
  // same omission to match the original artifact layout; Figma
  // accepts the file regardless.
  const doc0 = empty;

  const GRID_COLS = 4;
  const GRID_GAP = 30;
  const MARGIN = 50;

  const finalContext = FILL_FRAMES.reduce<FigDocumentContext>((acc, frameData, index) => {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const maxFrameWidth = 260;
    const maxFrameHeight = 120;
    const frameX = MARGIN + col * (maxFrameWidth + GRID_GAP);
    const frameY = MARGIN + row * (maxFrameHeight + GRID_GAP);
    const bgColor = hexToRgb(frameData.background);

    const frameResult = addNode({
      state, context: acc, pageGuid, parentGuid: null,
      spec: {
        visible: true,
        opacity: 1,
        type: "FRAME",
        name: frameData.name,
        x: frameX, y: frameY,
        width: frameData.width, height: frameData.height,
        fills: [solidPaint({ ...bgColor, a: 1 })],
        clipsContent: true,
      },
    });

    return frameData.children.reduce<FigDocumentContext>(
      (innerAcc, child) => addFillChild(state, innerAcc, pageGuid, frameResult.nodeGuid, child),
      frameResult.context,
    );
  }, doc0);

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
  console.log(`Frames: ${FILL_FRAMES.length}`);
  console.log(`\nFrame list:`);
  for (const frame of FILL_FRAMES) {
    console.log(`  - ${frame.name} (${frame.width}x${frame.height})`);
  }

  console.log(`\nNext steps:`);
  console.log(`1. Open ${OUTPUT_FILE} in Figma`);
  console.log(`2. Apply gradients manually (solid fills are applied, gradients need Figma)`);
  console.log(`3. Export each frame as SVG to ${actualDir}/`);
  console.log(`4. Run: npx vitest run packages/@higma-document-renderers/fig/spec/fills.spec.ts`);
}

generateFillFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
