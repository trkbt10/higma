#!/usr/bin/env bun
/**
 * @file Generate vector winding rule fixture .fig file
 *
 * Tests that VECTOR nodes with multiple subpaths and different winding
 * rules render correctly. Specifically:
 * - evenodd with inner hole (donut via subpaths)
 * - nonzero overlapping subpaths
 * - Multiple fillGeometry entries with mixed winding rules
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-vector-winding-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
  updateNode,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES, STROKE_CAP_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor, FigNode, FigPaint, FigStrokeCap } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/vector-winding");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "vector-winding.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };
const BLUE: FigColor = { r: 0.2, g: 0.4, b: 0.9, a: 1 };
const RED: FigColor = { r: 0.9, g: 0.2, b: 0.2, a: 1 };
const GREEN: FigColor = { r: 0.2, g: 0.7, b: 0.3, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function fullEllipseArcData(innerRadius: number): NonNullable<FigNode["arcData"]> {
  return {
    startingAngle: 0,
    endingAngle: Math.PI * 2,
    innerRadius,
  };
}

function arcData(
  startingAngle: number,
  endingAngle: number,
  innerRadius: number,
): NonNullable<FigNode["arcData"]> {
  return { startingAngle, endingAngle, innerRadius };
}

function strokeCapValue(name: FigStrokeCap): NonNullable<FigNode["strokeCap"]> {
  return { value: STROKE_CAP_VALUES[name], name };
}

type Args = {
  readonly context: FigDocumentContext;
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
  readonly frameX: number;
  readonly frameY: number;
};

type Result = { readonly context: FigDocumentContext };

function addFrame(
  args: Args & { name: string; bg: FigColor },
): { context: FigDocumentContext; frameId: FigGuid } {
  const r = addNode({
    state: args.state,
    context: args.context,
    pageGuid: args.pageGuid,
    parentGuid: null,
    spec: {
      type: "FRAME",
      name: args.name,
      x: args.frameX,
      y: args.frameY,
      width: 120,
      height: 120,
      fills: [solidPaint(args.bg)],
      clipsContent: true,
    },
  });
  return { context: r.context, frameId: r.nodeGuid };
}

/** Donut shape via ellipse innerRadius. */
function addEvenoddDonut(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-evenodd-donut", bg: LIGHT_GRAY });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "donut",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [solidPaint(BLUE)],
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({ ...n, arcData: fullEllipseArcData(0.5) }),
  });
  return { context: finalContext };
}

/** Full ring — tests evenodd produces ring, not filled circle. */
function addEvenoddFullRing(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-evenodd-ring", bg: WHITE });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "ring",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [solidPaint(RED)],
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({ ...n, arcData: fullEllipseArcData(0.7) }),
  });
  return { context: finalContext };
}

/** Donut with stroke. */
function addDonutWithStroke(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-donut-stroke", bg: WHITE });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "donut-stroked",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [solidPaint(GREEN)],
      strokes: [solidPaint({ r: 0.1, g: 0.1, b: 0.1, a: 1 })],
      strokeWeight: 2,
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({ ...n, arcData: fullEllipseArcData(0.4) }),
  });
  return { context: finalContext };
}

/** Semicircle arc (0–180°). */
function addArcSemicircle(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-arc-semi", bg: WHITE });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "semicircle",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [solidPaint(BLUE)],
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({
      ...n,
      arcData: arcData(0, Math.PI, 0), // 180deg in radians (Figma stores angles in radians)
    }),
  });
  return { context: finalContext };
}

/** Arc donut segment — 0..270° with inner radius. */
function addArcDonutSegment(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-arc-donut", bg: LIGHT_GRAY });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "ring-segment",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [solidPaint(RED)],
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({
      ...n,
      arcData: arcData(0, (270 * Math.PI) / 180, 0.6),
    }),
  });
  return { context: finalContext };
}

/** Stroke-only arc (progress ring). */
function addStrokeOnlyArc(args: Args): Result {
  const frame = addFrame({ ...args, name: "winding-stroke-arc", bg: WHITE });
  const shape = addNode({
    state: args.state,
    context: frame.context,
    pageGuid: args.pageGuid,
    parentGuid: frame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "progress-ring",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [],
      strokes: [solidPaint(GREEN)],
      strokeWeight: 6,
    },
  });
  const finalContext = updateNode({
    context: shape.context,
    nodeGuid: shape.nodeGuid,
    update: (n) => ({
      ...n,
      strokeCap: strokeCapValue("ROUND"),
      arcData: arcData((270 * Math.PI) / 180, (630 * Math.PI) / 180, 1),
    }),
  });
  return { context: finalContext };
}

async function generateVectorWindingFixtures(): Promise<void> {
  console.log("Generating vector winding rule fixtures...\n");

  const empty = createEmptyFigDocument("VectorWinding");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "VectorWinding").guid;
  const doc0 = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const GRID_COLS = 3;
  const COL_WIDTH = 160;
  const ROW_HEIGHT = 160;
  const MARGIN = 50;

  type Builder = (args: Args) => Result;

  const builders: { name: string; fn: Builder }[] = [
    { name: "Evenodd donut", fn: addEvenoddDonut },
    { name: "Evenodd full ring", fn: addEvenoddFullRing },
    { name: "Donut with stroke", fn: addDonutWithStroke },
    { name: "Arc semicircle", fn: addArcSemicircle },
    { name: "Arc donut segment", fn: addArcDonutSegment },
    { name: "Stroke-only arc (progress)", fn: addStrokeOnlyArc },
  ];

  const finalContext = builders.reduce<FigDocumentContext>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const frameX = MARGIN + col * COL_WIDTH;
    const frameY = MARGIN + row * ROW_HEIGHT;
    return b.fn({ context: acc, state, pageGuid, frameX, frameY }).context;
  }, doc0);

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
}

generateVectorWindingFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
