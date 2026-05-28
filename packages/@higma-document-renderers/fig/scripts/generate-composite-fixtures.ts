#!/usr/bin/env bun
/**
 * @file Generate composite (boolean operation) fixture .fig file
 *
 * Creates a .fig file with various boolean operation test cases to verify
 * that the renderer correctly uses pre-computed geometry from BOOLEAN_OPERATION
 * nodes instead of rendering children individually.
 *
 * Test categories:
 * 1. Basic operations: union, subtract, intersect, exclude with simple shapes
 * 2. Icon patterns: real-world icon-like composites (settings gear, eye, shield, etc.)
 * 3. Nested booleans: boolean operations containing other boolean operations
 * 4. Multi-operand: more than 2 children in a single boolean operation
 * 5. Edge cases: identical shapes, non-overlapping shapes, fully contained shapes
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-composite-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
  type SolidPaintSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/composite");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "composite.fig");

// =============================================================================
// Colors
// =============================================================================

const COLORS = {
  blue: { r: 0.2, g: 0.4, b: 0.9, a: 1 } satisfies FigColor,
  red: { r: 0.9, g: 0.2, b: 0.2, a: 1 } satisfies FigColor,
  green: { r: 0.2, g: 0.7, b: 0.3, a: 1 } satisfies FigColor,
  orange: { r: 0.9, g: 0.5, b: 0.1, a: 1 } satisfies FigColor,
  purple: { r: 0.5, g: 0.2, b: 0.8, a: 1 } satisfies FigColor,
  teal: { r: 0.1, g: 0.6, b: 0.6, a: 1 } satisfies FigColor,
  dark: { r: 0.2, g: 0.2, b: 0.2, a: 1 } satisfies FigColor,
  gray: { r: 0.6, g: 0.6, b: 0.6, a: 1 } satisfies FigColor,
  white: { r: 1, g: 1, b: 1, a: 1 } satisfies FigColor,
  bgGray: { r: 0.95, g: 0.95, b: 0.95, a: 1 } satisfies FigColor,
} as const;

function solidPaint(color: FigColor): SolidPaintSpec {
  return { type: "SOLID", color, opacity: 1, visible: true };
}

import type { BooleanOperation } from "@higma-document-models/fig/boolean-operation";

// =============================================================================
// Frame and boolean construction
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
};

type AddedFrame = { readonly context: FigDocumentContext; readonly id: FigGuid };

function addFrame(
  context: FigDocumentContext,
  ctx: Ctx,
  parentGuid: FigGuid | null,
  opts: {
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
    context,
    pageGuid: ctx.pageGuid,
    parentGuid,
    spec: {
      visible: true,
      opacity: 1,
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
  return { context: r.context, id: r.nodeGuid };
}

function addBoolean(
  context: FigDocumentContext,
  ctx: Ctx,
  parentGuid: FigGuid,
  opts: {
    readonly name: string;
    readonly operation: BooleanOperation;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly fill?: SolidPaintSpec;
    readonly opacity?: number;
  },
): AddedFrame {
  const r = addNode({
    state: ctx.state,
    context,
    pageGuid: ctx.pageGuid,
    parentGuid,
    spec: {
      visible: true,
      type: "BOOLEAN_OPERATION",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      booleanOperation: opts.operation,
      fills: opts.fill ? [opts.fill] : undefined,
      opacity: opts.opacity ?? 1,
    },
  });
  return { context: r.context, id: r.nodeGuid };
}

type ChildShape =
  | { readonly kind: "RECT"; readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "ROUNDED"; readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly cornerRadius?: number }
  | { readonly kind: "ELLIPSE"; readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "STAR"; readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly pointCount?: number; readonly innerRadius?: number }
  | { readonly kind: "POLYGON"; readonly name: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly sides?: number };

function addChild(
  context: FigDocumentContext,
  ctx: Ctx,
  parentGuid: FigGuid,
  child: ChildShape,
): FigDocumentContext {
  switch (child.kind) {
    case "RECT":
      return addNode({
        state: ctx.state,
        context,
        pageGuid: ctx.pageGuid,
        parentGuid,
        spec: {
      visible: true,
      opacity: 1, type: "RECTANGLE", name: child.name, x: child.x, y: child.y, width: child.w, height: child.h },
      }).context;
    case "ROUNDED":
      return addNode({
        state: ctx.state,
        context,
        pageGuid: ctx.pageGuid,
        parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "ROUNDED_RECTANGLE",
          name: child.name,
          x: child.x,
          y: child.y,
          width: child.w,
          height: child.h,
          cornerRadius: child.cornerRadius,
        },
      }).context;
    case "ELLIPSE":
      return addNode({
        state: ctx.state,
        context,
        pageGuid: ctx.pageGuid,
        parentGuid,
        spec: {
      visible: true,
      opacity: 1, type: "ELLIPSE", name: child.name, x: child.x, y: child.y, width: child.w, height: child.h },
      }).context;
    case "STAR":
      return addNode({
        state: ctx.state,
        context,
        pageGuid: ctx.pageGuid,
        parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "STAR",
          name: child.name,
          x: child.x,
          y: child.y,
          width: child.w,
          height: child.h,
          pointCount: child.pointCount,
          starInnerRadius: child.innerRadius,
        },
      }).context;
    case "POLYGON":
      return addNode({
        state: ctx.state,
        context,
        pageGuid: ctx.pageGuid,
        parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "REGULAR_POLYGON",
          name: child.name,
          x: child.x,
          y: child.y,
          width: child.w,
          height: child.h,
          pointCount: child.sides,
        },
      }).context;
  }
}

// =============================================================================
// Fixture builders
// =============================================================================

type Args = { readonly context: FigDocumentContext; readonly ctx: Ctx; readonly x: number; readonly y: number };
type Result = { readonly context: FigDocumentContext };

function buildWithChildren(
  args: Args,
  frameName: string,
  frameSize: { w: number; h: number; background: FigColor },
  bool: {
    name: string;
    operation: BooleanOperation;
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: SolidPaintSpec;
    opacity?: number;
  },
  children: readonly ChildShape[],
): Result {
  const frame = addFrame(args.context, args.ctx, null, {
    name: frameName,
    x: args.x,
    y: args.y,
    width: frameSize.w,
    height: frameSize.h,
    background: frameSize.background,
  });
  const bo = addBoolean(frame.context, args.ctx, frame.id, {
    name: bool.name,
    operation: bool.operation,
    x: bool.x,
    y: bool.y,
    width: bool.w,
    height: bool.h,
    fill: bool.fill,
    opacity: bool.opacity,
  });
  const filled = children.reduce<FigDocumentContext>(
    (acc, child) => addChild(acc, args.ctx, bo.id, child),
    bo.context,
  );
  return { context: filled };
}

function addBasicUnion(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-union-basic",
    { w: 200, h: 150, background: COLORS.white },
    { name: "union", operation: "UNION", x: 40, y: 35, w: 120, h: 80, fill: solidPaint(COLORS.blue) },
    [
      { kind: "RECT", name: "rect", x: 0, y: 10, w: 80, h: 60 },
      { kind: "ELLIPSE", name: "circle", x: 50, y: 0, w: 60, h: 60 },
    ],
  );
}

function addBasicSubtract(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-subtract-basic",
    { w: 200, h: 150, background: COLORS.white },
    { name: "subtract", operation: "SUBTRACT", x: 40, y: 35, w: 120, h: 80, fill: solidPaint(COLORS.red) },
    [
      { kind: "RECT", name: "base-rect", x: 0, y: 0, w: 120, h: 80 },
      { kind: "ELLIPSE", name: "cut-circle", x: 35, y: 15, w: 50, h: 50 },
    ],
  );
}

function addBasicIntersect(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-intersect-basic",
    { w: 200, h: 150, background: COLORS.white },
    { name: "intersect", operation: "INTERSECT", x: 40, y: 35, w: 120, h: 80, fill: solidPaint(COLORS.green) },
    [
      { kind: "RECT", name: "rect", x: 0, y: 0, w: 80, h: 80 },
      { kind: "ELLIPSE", name: "circle", x: 40, y: 0, w: 80, h: 80 },
    ],
  );
}

function addBasicExclude(args: Args): Result {
  // EXCLUDE in the fig-file builder UI maps to XOR in the schema.
  return buildWithChildren(
    args,
    "composite-exclude-basic",
    { w: 200, h: 150, background: COLORS.white },
    { name: "exclude", operation: "XOR", x: 40, y: 35, w: 120, h: 80, fill: solidPaint(COLORS.orange) },
    [
      { kind: "RECT", name: "rect", x: 0, y: 0, w: 80, h: 80 },
      { kind: "ELLIPSE", name: "circle", x: 40, y: 0, w: 80, h: 80 },
    ],
  );
}

function addIconGear(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-icon-gear",
    { w: 120, h: 120, background: COLORS.white },
    { name: "gear", operation: "SUBTRACT", x: 20, y: 20, w: 80, h: 80, fill: solidPaint(COLORS.dark) },
    [
      { kind: "STAR", name: "gear-body", x: 0, y: 0, w: 80, h: 80, pointCount: 8, innerRadius: 0.7 },
      { kind: "ELLIPSE", name: "gear-hole", x: 25, y: 25, w: 30, h: 30 },
    ],
  );
}

function addIconEye(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-icon-eye",
    { w: 160, h: 100, background: COLORS.white },
    { name: "eye-shape", operation: "INTERSECT", x: 20, y: 20, w: 120, h: 60, fill: solidPaint(COLORS.teal) },
    [
      { kind: "ELLIPSE", name: "upper-lid", x: 0, y: -10, w: 120, h: 80 },
      { kind: "ELLIPSE", name: "lower-lid", x: 0, y: -10, w: 120, h: 80 },
    ],
  );
}

function addIconShield(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-icon-shield",
    { w: 120, h: 140, background: COLORS.white },
    { name: "shield", operation: "SUBTRACT", x: 20, y: 20, w: 80, h: 100, fill: solidPaint(COLORS.blue) },
    [
      { kind: "ROUNDED", name: "shield-body", x: 0, y: 0, w: 80, h: 100, cornerRadius: 10 },
      { kind: "ROUNDED", name: "shield-cutout", x: 10, y: 10, w: 60, h: 80, cornerRadius: 6 },
    ],
  );
}

function addMultiOperandUnion(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-multi-union",
    { w: 160, h: 160, background: COLORS.white },
    { name: "clover", operation: "UNION", x: 30, y: 30, w: 100, h: 100, fill: solidPaint(COLORS.green) },
    [
      { kind: "ELLIPSE", name: "petal-0", x: 20, y: 0, w: 60, h: 60 },
      { kind: "ELLIPSE", name: "petal-1", x: 20, y: 40, w: 60, h: 60 },
      { kind: "ELLIPSE", name: "petal-2", x: 0, y: 20, w: 60, h: 60 },
      { kind: "ELLIPSE", name: "petal-3", x: 40, y: 20, w: 60, h: 60 },
    ],
  );
}

function addNestedBoolean({ context, ctx, x, y }: Args): Result {
  // BOOLEAN inside BOOLEAN — outer subtract, inner union.
  const frame = addFrame(context, ctx, null, { name: "composite-nested", x, y, width: 200, height: 150, background: COLORS.white });
  const outer = addBoolean(frame.context, ctx, frame.id, {
    name: "outer-subtract",
    operation: "SUBTRACT",
    x: 30,
    y: 25,
    width: 140,
    height: 100,
    fill: solidPaint(COLORS.purple),
  });
  const inner = addBoolean(outer.context, ctx, outer.id, {
    name: "inner-union",
    operation: "UNION",
    x: 0,
    y: 0,
    width: 140,
    height: 100,
  });
  const innerFilled = ([
    { kind: "RECT" as const, name: "rect", x: 0, y: 15, w: 100, h: 70 },
    { kind: "ELLIPSE" as const, name: "circle", x: 70, y: 0, w: 70, h: 70 },
  ]).reduce<FigDocumentContext>(
    (acc, c) => addChild(acc, ctx, inner.id, c),
    inner.context,
  );
  const cutout = addChild(innerFilled, ctx, outer.id, {
    kind: "ELLIPSE",
    name: "cutout",
    x: 50,
    y: 30,
    w: 40,
    h: 40,
  });
  return { context: cutout };
}

function addNonOverlapping(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-non-overlapping",
    { w: 200, h: 100, background: COLORS.white },
    { name: "subtract-no-overlap", operation: "SUBTRACT", x: 15, y: 20, w: 170, h: 60, fill: solidPaint(COLORS.gray) },
    [
      { kind: "RECT", name: "left-rect", x: 0, y: 0, w: 60, h: 60 },
      { kind: "ELLIPSE", name: "right-circle", x: 110, y: 0, w: 60, h: 60 },
    ],
  );
}

function addFullyContained(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-fully-contained",
    { w: 160, h: 120, background: COLORS.white },
    { name: "picture-frame", operation: "SUBTRACT", x: 20, y: 20, w: 120, h: 80, fill: solidPaint(COLORS.dark) },
    [
      { kind: "RECT", name: "outer", x: 0, y: 0, w: 120, h: 80 },
      { kind: "RECT", name: "inner", x: 20, y: 20, w: 80, h: 40 },
    ],
  );
}

function addIconPlayButton(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-icon-play",
    { w: 120, h: 120, background: COLORS.white },
    { name: "play-btn", operation: "SUBTRACT", x: 20, y: 20, w: 80, h: 80, fill: solidPaint(COLORS.red) },
    [
      { kind: "ELLIPSE", name: "circle", x: 0, y: 0, w: 80, h: 80 },
      { kind: "POLYGON", name: "triangle", x: 30, y: 23, w: 30, h: 34, sides: 3 },
    ],
  );
}

function addMultipleBooleans({ context, ctx, x, y }: Args): Result {
  const frame = addFrame(context, ctx, null, { name: "composite-multiple", x, y, width: 300, height: 120, background: COLORS.white });

  type Group = {
    name: string;
    op: BooleanOperation;
    bx: number;
    fill: FigColor;
    children: readonly ChildShape[];
  };
  const groups: readonly Group[] = [
    {
      name: "union-part",
      op: "UNION",
      bx: 10,
      fill: COLORS.blue,
      children: [
        { kind: "RECT", name: "r1", x: 0, y: 15, w: 50, h: 50 },
        { kind: "ELLIPSE", name: "c1", x: 30, y: 0, w: 50, h: 50 },
      ],
    },
    {
      name: "subtract-part",
      op: "SUBTRACT",
      bx: 110,
      fill: COLORS.red,
      children: [
        { kind: "RECT", name: "r2", x: 10, y: 10, w: 60, h: 60 },
        { kind: "ELLIPSE", name: "c2", x: 20, y: 20, w: 40, h: 40 },
      ],
    },
    {
      name: "exclude-part",
      op: "XOR",
      bx: 210,
      fill: COLORS.green,
      children: [
        { kind: "RECT", name: "r3", x: 0, y: 10, w: 50, h: 60 },
        { kind: "ELLIPSE", name: "c3", x: 30, y: 15, w: 50, h: 50 },
      ],
    },
  ];

  return {
    context: groups.reduce<FigDocumentContext>((acc, g) => {
      const bo = addBoolean(acc, ctx, frame.id, {
        name: g.name,
        operation: g.op,
        x: g.bx,
        y: 20,
        width: 80,
        height: 80,
        fill: solidPaint(g.fill),
      });
      return g.children.reduce<FigDocumentContext>(
        (innerAcc, c) => addChild(innerAcc, ctx, bo.id, c),
        bo.context,
      );
    }, frame.context),
  };
}

function addBooleanWithOpacity(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-opacity",
    { w: 200, h: 150, background: COLORS.bgGray },
    {
      name: "semi-transparent-union",
      operation: "UNION",
      x: 40,
      y: 35,
      w: 120,
      h: 80,
      fill: solidPaint(COLORS.dark),
      opacity: 0.5,
    },
    [
      { kind: "RECT", name: "rect", x: 0, y: 10, w: 80, h: 60 },
      { kind: "ELLIPSE", name: "circle", x: 50, y: 0, w: 60, h: 60 },
    ],
  );
}

function addIconBell(args: Args): Result {
  return buildWithChildren(
    args,
    "composite-icon-bell",
    { w: 120, h: 140, background: COLORS.white },
    { name: "bell", operation: "UNION", x: 20, y: 15, w: 80, h: 100, fill: solidPaint(COLORS.orange) },
    [
      { kind: "ROUNDED", name: "bell-body", x: 10, y: 0, w: 60, h: 70, cornerRadius: 20 },
      { kind: "RECT", name: "bell-brim", x: 0, y: 65, w: 80, h: 10 },
      { kind: "ELLIPSE", name: "clapper", x: 30, y: 80, w: 20, h: 20 },
    ],
  );
}

// =============================================================================
// Main
// =============================================================================

async function generate(): Promise<void> {
  console.log("Generating composite (boolean operation) fixtures...\n");

  const empty = createEmptyFigDocument("Composite");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Composite").guid;
  const ctx: Ctx = { state, pageGuid };
  const doc0 = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const GRID_COLS = 4;
  const COL_WIDTH = 320;
  const ROW_HEIGHT = 180;
  const MARGIN = 50;

  type Builder = (args: Args) => Result;
  const builders: { name: string; fn: Builder }[] = [
    { name: "Basic UNION", fn: addBasicUnion },
    { name: "Basic SUBTRACT", fn: addBasicSubtract },
    { name: "Basic INTERSECT", fn: addBasicIntersect },
    { name: "Basic EXCLUDE", fn: addBasicExclude },
    { name: "Icon: Gear", fn: addIconGear },
    { name: "Icon: Eye", fn: addIconEye },
    { name: "Icon: Shield", fn: addIconShield },
    { name: "Multi-operand UNION", fn: addMultiOperandUnion },
    { name: "Nested boolean", fn: addNestedBoolean },
    { name: "Non-overlapping", fn: addNonOverlapping },
    { name: "Fully contained", fn: addFullyContained },
    { name: "Icon: Play button", fn: addIconPlayButton },
    { name: "Multiple booleans", fn: addMultipleBooleans },
    { name: "Boolean with opacity", fn: addBooleanWithOpacity },
    { name: "Icon: Bell", fn: addIconBell },
  ];

  const finalContext = builders.reduce<FigDocumentContext>((acc, b, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = MARGIN + col * COL_WIDTH;
    const y = MARGIN + row * ROW_HEIGHT;
    return b.fn({ context: acc, ctx, x, y }).context;
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
  console.log("Frame list:");
  for (const b of builders) {
    console.log(`  - ${b.name}`);
  }
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
