#!/usr/bin/env bun
/**
 * @file Generate fixtures/autolayout/autolayout.fig
 *
 * The layout fixture generator writes fixtures/layouts/layouts.fig.
 * This script owns the AutoLayout fixture set and preserves the existing
 * 12 exported layer names while adding Phase B coverage.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFigFile, frameNode, roundedRectNode } from "@higma-document-io/fig/fig-file";
import type { Color, FrameNodeData } from "@higma-document-io/fig/fig-file";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/autolayout");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "autolayout.fig");

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const BG: Color = { r: 0.949, g: 0.949, b: 0.949, a: 1 };
const BLUE: Color = { r: 0.302, g: 0.302, b: 0.898, a: 1 };
const RED: Color = { r: 0.898, g: 0.302, b: 0.302, a: 1 };
const GREEN: Color = { r: 0.302, g: 0.898, b: 0.302, a: 1 };
const ORANGE: Color = { r: 1, g: 0.584, b: 0, a: 1 };
const PURPLE: Color = { r: 0.56, g: 0.33, b: 0.86, a: 1 };

const nextId = { value: 100 };
function id(): number {
  const current = nextId.value;
  nextId.value += 1;
  return current;
}

type RectSpec = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: Color;
  readonly radius?: number;
  readonly primaryGrow?: number;
  readonly positioning?: "AUTO" | "ABSOLUTE";
};

type ExistingCase = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly autoLayout?: "HORIZONTAL" | "VERTICAL";
  readonly gap?: number;
  readonly padding?: number;
  readonly primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  readonly counterAlign?: "MIN" | "CENTER" | "MAX";
  readonly children: readonly RectSpec[];
};

const EXISTING_CASES: readonly ExistingCase[] = [
  {
    name: "simple-rects",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    children: [
      { name: "rect1", x: 20, y: 20, width: 60, height: 60, fill: BLUE },
      { name: "rect2", x: 100, y: 80, width: 80, height: 40, fill: RED },
    ],
  },
  {
    name: "auto-h-min",
    x: 240,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 0, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 0, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-center",
    x: 420,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    primaryAlign: "CENTER",
    counterAlign: "CENTER",
    children: [
      { name: "red", x: 0, y: 80, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 70, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 75, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-max",
    x: 600,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    primaryAlign: "MAX",
    counterAlign: "MAX",
    children: [
      { name: "red", x: 0, y: 160, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 140, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 150, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-min",
    x: 780,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 0, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 0, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-center",
    x: 1020,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    primaryAlign: "CENTER",
    counterAlign: "CENTER",
    children: [
      { name: "red", x: 80, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 70, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 75, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-max",
    x: 1260,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    primaryAlign: "MAX",
    counterAlign: "MAX",
    children: [
      { name: "red", x: 160, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 140, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 150, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-space-between",
    x: 0,
    y: 240,
    width: 120,
    height: 200,
    autoLayout: "HORIZONTAL",
    primaryAlign: "SPACE_BETWEEN",
    counterAlign: "CENTER",
    children: [
      { name: "orange", x: 0, y: 80, width: 40, height: 40, fill: ORANGE, radius: 4 },
      { name: "lime", x: 40, y: 80, width: 40, height: 40, fill: GREEN, radius: 4 },
      { name: "sky", x: 80, y: 80, width: 40, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-gap-0",
    x: 240,
    y: 240,
    width: 150,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 0,
    children: [
      { name: "r1", x: 0, y: 0, width: 50, height: 50, fill: RED, radius: 4 },
      { name: "r2", x: 50, y: 0, width: 50, height: 50, fill: GREEN, radius: 4 },
      { name: "r3", x: 100, y: 0, width: 50, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-gap-20",
    x: 400,
    y: 240,
    width: 160,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 20,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 60, y: 0, width: 40, height: 40, fill: GREEN, radius: 4 },
      { name: "blue", x: 120, y: 0, width: 40, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-padding-20",
    x: 600,
    y: 240,
    width: 200,
    height: 88,
    autoLayout: "VERTICAL",
    gap: 8,
    children: [
      { name: "r1", x: 0, y: 0, width: 80, height: 40, fill: PURPLE, radius: 4 },
      { name: "r2", x: 0, y: 48, width: 80, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "constraints-corners",
    x: 780,
    y: 240,
    width: 200,
    height: 200,
    children: [
      { name: "tl", x: 10, y: 10, width: 30, height: 30, fill: RED },
      { name: "tr", x: 160, y: 10, width: 30, height: 30, fill: GREEN },
      { name: "c", x: 85, y: 85, width: 30, height: 30, fill: ORANGE },
      { name: "bl", x: 10, y: 160, width: 30, height: 30, fill: BLUE },
      { name: "br", x: 160, y: 160, width: 30, height: 30, fill: PURPLE },
    ],
  },
];

function addFrame(figFile: ReturnType<typeof createFigFile>, data: FrameNodeData): void {
  figFile.addFrame(data);
}

function addRect(figFile: ReturnType<typeof createFigFile>, parentId: number, spec: RectSpec): void {
  let builder = roundedRectNode(id(), parentId)
    .name(spec.name)
    .size(spec.width, spec.height)
    .position(spec.x, spec.y)
    .fill(spec.fill)
    .cornerRadius(spec.radius ?? 0);
  if (spec.primaryGrow !== undefined) {
    builder = builder.primaryGrow(spec.primaryGrow);
  }
  if (spec.positioning !== undefined) {
    builder = builder.positioning(spec.positioning);
  }
  figFile.addRoundedRectangle(builder.build());
}

function gridTrackEntries(count: number): { readonly entries: readonly { readonly id: { readonly sessionID: number; readonly localID: number }; readonly position: string }[] } {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      id: { sessionID: 1, localID: 9000 + index },
      position: String.fromCharCode(33 + index),
    })),
  };
}

function addExistingCase(figFile: ReturnType<typeof createFigFile>, canvasId: number, item: ExistingCase): void {
  const frameId = id();
  let builder = frameNode(frameId, canvasId)
    .name(item.name)
    .size(item.width, item.height)
    .position(item.x, item.y)
    .background(BG)
    .exportAsSVG();
  if (item.autoLayout) {
    builder = builder.autoLayout(item.autoLayout);
  }
  if (item.gap !== undefined) {
    builder = builder.gap(item.gap);
  }
  if (item.padding !== undefined) {
    builder = builder.padding(item.padding);
  }
  if (item.primaryAlign !== undefined) {
    builder = builder.primaryAlign(item.primaryAlign);
  }
  if (item.counterAlign !== undefined) {
    builder = builder.counterAlign(item.counterAlign);
  }
  addFrame(figFile, builder.build());
  for (const child of item.children) {
    addRect(figFile, frameId, child);
  }
}

function addPhaseBFixtures(figFile: ReturnType<typeof createFigFile>, canvasId: number): void {
  const startY = 520;

  const gridId = id();
  addFrame(figFile, {
    ...frameNode(gridId, canvasId).name("auto-grid-2x3").size(124, 138).position(0, startY).background(WHITE).autoLayout("GRID").gap(12).counterGap(8).padding(16).exportAsSVG().build(),
    gridColumns: gridTrackEntries(2),
    gridRows: gridTrackEntries(3),
    gridColumnGap: 12,
    gridRowGap: 8,
  });
  for (let index = 0; index < 6; index++) {
    addRect(figFile, gridId, { name: `cell-${index + 1}`, x: 0, y: 0, width: 40, height: 30, fill: [RED, GREEN, BLUE, ORANGE, PURPLE, BLUE][index], radius: 4 });
  }

  const wrapId = id();
  addFrame(figFile, frameNode(wrapId, canvasId).name("auto-wrap-3-rows").size(130, 160).position(180, startY).background(WHITE).autoLayout("HORIZONTAL").wrap(true).gap(10).counterGap(8).contentAlign("CENTER").counterAlign("CENTER").exportAsSVG().build());
  for (let index = 0; index < 5; index++) {
    addRect(figFile, wrapId, { name: `wrap-${index + 1}`, x: 0, y: 0, width: 60, height: 20, fill: [RED, GREEN, BLUE, ORANGE, PURPLE][index], radius: 4 });
  }

  const hugHId = id();
  addFrame(figFile, frameNode(hugHId, canvasId).name("auto-hug-h").size(136, 46).position(360, startY).background(WHITE).autoLayout("HORIZONTAL").gap(10).padding(8).primarySizing("RESIZE_TO_FIT").counterSizing("RESIZE_TO_FIT").exportAsSVG().build());
  addRect(figFile, hugHId, { name: "a", x: 0, y: 0, width: 30, height: 20, fill: RED, radius: 4 });
  addRect(figFile, hugHId, { name: "b", x: 0, y: 0, width: 50, height: 30, fill: GREEN, radius: 4 });
  addRect(figFile, hugHId, { name: "c", x: 0, y: 0, width: 20, height: 25, fill: BLUE, radius: 4 });

  const hugVId = id();
  addFrame(figFile, frameNode(hugVId, canvasId).name("auto-hug-v").size(66, 111).position(520, startY).background(WHITE).autoLayout("VERTICAL").gap(10).padding(8).primarySizing("RESIZE_TO_FIT").counterSizing("RESIZE_TO_FIT").exportAsSVG().build());
  addRect(figFile, hugVId, { name: "a", x: 0, y: 0, width: 30, height: 20, fill: RED, radius: 4 });
  addRect(figFile, hugVId, { name: "b", x: 0, y: 0, width: 50, height: 30, fill: GREEN, radius: 4 });
  addRect(figFile, hugVId, { name: "c", x: 0, y: 0, width: 20, height: 25, fill: BLUE, radius: 4 });

  const growId = id();
  addFrame(figFile, frameNode(growId, canvasId).name("auto-fill-grow").size(200, 60).position(640, startY).background(WHITE).autoLayout("HORIZONTAL").gap(10).padding(10).exportAsSVG().build());
  addRect(figFile, growId, { name: "fixed-a", x: 0, y: 0, width: 40, height: 30, fill: RED, radius: 4 });
  addRect(figFile, growId, { name: "grow", x: 0, y: 0, width: 10, height: 30, fill: GREEN, radius: 4, primaryGrow: 1 });
  addRect(figFile, growId, { name: "fixed-b", x: 0, y: 0, width: 50, height: 30, fill: BLUE, radius: 4 });

  const minId = id();
  addFrame(figFile, frameNode(minId, canvasId).name("auto-min-clamp").size(200, 120).position(880, startY).background(WHITE).autoLayout("VERTICAL").gap(4).padding(10).primarySizing("RESIZE_TO_FIT").counterSizing("RESIZE_TO_FIT").minSize({ x: 200, y: 120 }).exportAsSVG().build());
  addRect(figFile, minId, { name: "short-a", x: 0, y: 0, width: 60, height: 30, fill: RED, radius: 4 });
  addRect(figFile, minId, { name: "short-b", x: 0, y: 0, width: 60, height: 20, fill: GREEN, radius: 4 });

  const maxId = id();
  addFrame(figFile, frameNode(maxId, canvasId).name("auto-max-clamp").size(80, 240).position(1120, startY).background(WHITE).autoLayout("VERTICAL").gap(8).padding(10).primarySizing("RESIZE_TO_FIT").counterSizing("RESIZE_TO_FIT").maxSize({ x: 200, y: 240 }).exportAsSVG().build());
  for (let index = 0; index < 3; index++) {
    addRect(figFile, maxId, { name: `tall-${index + 1}`, x: 0, y: 0, width: 60, height: 100, fill: [RED, GREEN, BLUE][index], radius: 4 });
  }

  const aspectId = id();
  addFrame(figFile, frameNode(aspectId, canvasId).name("auto-aspect-lock").size(320, 180).position(0, startY + 220).background(WHITE).lockAspectRatio(16, 9).autoLayout("HORIZONTAL").padding(20).exportAsSVG().build());
  addRect(figFile, aspectId, { name: "child", x: 0, y: 0, width: 80, height: 60, fill: BLUE, radius: 4 });

  for (const [index, takeSpace] of [true, false].entries()) {
    const strokeId = id();
    addFrame(figFile, frameNode(strokeId, canvasId).name(takeSpace ? "auto-strokes-on" : "auto-strokes-off").size(140, 80).position(360 + index * 180, startY + 220).background(WHITE).stroke(BLUE).strokeWeight(8).bordersTakeSpace(takeSpace).autoLayout("HORIZONTAL").padding(8).exportAsSVG().build());
    addRect(figFile, strokeId, { name: "child", x: 0, y: 0, width: 40, height: 30, fill: RED, radius: 4 });
  }

  const reverseId = id();
  addFrame(figFile, frameNode(reverseId, canvasId).name("auto-z-reverse").size(140, 70).position(720, startY + 220).background(WHITE).autoLayout("HORIZONTAL").gap(-20).reverseZIndex(true).exportAsSVG().build());
  addRect(figFile, reverseId, { name: "bottom-authored-first", x: 0, y: 0, width: 60, height: 50, fill: RED, radius: 4 });
  addRect(figFile, reverseId, { name: "middle", x: 0, y: 0, width: 60, height: 50, fill: GREEN, radius: 4 });
  addRect(figFile, reverseId, { name: "top-authored-last", x: 0, y: 0, width: 60, height: 50, fill: BLUE, radius: 4 });

  const absId = id();
  addFrame(figFile, frameNode(absId, canvasId).name("auto-absolute-mix").size(190, 80).position(900, startY + 220).background(WHITE).autoLayout("HORIZONTAL").gap(10).padding(10).exportAsSVG().build());
  addRect(figFile, absId, { name: "flow-a", x: 0, y: 0, width: 40, height: 30, fill: RED, radius: 4 });
  addRect(figFile, absId, { name: "flow-b", x: 0, y: 0, width: 40, height: 30, fill: GREEN, radius: 4 });
  addRect(figFile, absId, { name: "flow-c", x: 0, y: 0, width: 40, height: 30, fill: BLUE, radius: 4 });
  addRect(figFile, absId, { name: "absolute", x: 120, y: 35, width: 50, height: 30, fill: ORANGE, radius: 4, positioning: "ABSOLUTE" });

  const asymId = id();
  addFrame(figFile, frameNode(asymId, canvasId).name("auto-padding-asym").size(128, 60).position(1140, startY + 220).background(WHITE).autoLayout("VERTICAL").padding({ left: 4, right: 24, top: 12, bottom: 8 }).exportAsSVG().build());
  addRect(figFile, asymId, { name: "full-inner", x: 0, y: 0, width: 100, height: 30, fill: GREEN, radius: 4 });

  const nestedId = id();
  addFrame(figFile, frameNode(nestedId, canvasId).name("auto-nested").size(260, 130).position(0, startY + 440).background(WHITE).autoLayout("HORIZONTAL").gap(16).padding(12).exportAsSVG().build());
  const leftId = id();
  addFrame(figFile, frameNode(leftId, nestedId).name("left-hug").size(66, 76).position(0, 0).background(BG).autoLayout("VERTICAL").gap(8).padding(8).primarySizing("RESIZE_TO_FIT").counterSizing("RESIZE_TO_FIT").build());
  addRect(figFile, leftId, { name: "left-a", x: 0, y: 0, width: 50, height: 24, fill: RED, radius: 4 });
  addRect(figFile, leftId, { name: "left-b", x: 0, y: 0, width: 30, height: 28, fill: GREEN, radius: 4 });
  const rightId = id();
  addFrame(figFile, {
    ...frameNode(rightId, nestedId).name("right-grid").size(92, 92).position(0, 0).background(BG).autoLayout("GRID").gap(8).counterGap(8).padding(8).build(),
    gridColumns: gridTrackEntries(2),
    gridRows: gridTrackEntries(2),
  });
  for (let index = 0; index < 4; index++) {
    addRect(figFile, rightId, { name: `right-${index + 1}`, x: 0, y: 0, width: 34, height: 34, fill: [BLUE, ORANGE, PURPLE, GREEN][index], radius: 4 });
  }

  const stretchId = id();
  addFrame(figFile, frameNode(stretchId, canvasId).name("auto-stretch-counter").size(180, 90).position(320, startY + 440).background(WHITE).autoLayout("HORIZONTAL").gap(12).padding(10).counterAlign("MIN").exportAsSVG().build());
  const stretchChildId = id();
  addFrame(figFile, frameNode(stretchChildId, stretchId).name("stretch-child").size(40, 20).position(0, 0).background(PURPLE).childAlignSelf("STRETCH").build());
  addRect(figFile, stretchId, { name: "fixed-child", x: 0, y: 0, width: 50, height: 30, fill: BLUE, radius: 4 });
}

async function generate(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const figFile = createFigFile();
  const docId = figFile.addDocument("AutoLayout");
  const canvasId = figFile.addCanvas(docId, "AutoLayout Fixtures");
  // Internal Only Canvas is required by Figma's importer (see CLAUDE.md).
  figFile.addInternalCanvas(docId);

  for (const item of EXISTING_CASES) {
    addExistingCase(figFile, canvasId, item);
  }
  addPhaseBFixtures(figFile, canvasId);

  const figData = await figFile.buildAsync({ fileName: "autolayout" });
  fs.writeFileSync(OUTPUT_FILE, figData);
  console.log(`Written: ${OUTPUT_FILE}`);
  console.log(`Size: ${(figData.byteLength / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
