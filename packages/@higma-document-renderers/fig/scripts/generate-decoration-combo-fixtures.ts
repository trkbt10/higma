#!/usr/bin/env bun
/**
 * @file Generate decoration combination fixture .fig file
 *
 * Tests combinations of decorative properties that are individually tested
 * but never tested together. Specifically:
 *
 * Category 1: Gradient + Corner Radius
 * Category 2: Gradient + Effects (shadow, blur)
 * Category 3: Corner Radius + Effects + Fill combos
 * Category 4: Boolean operation with decorated operands
 * Category 5: Instance with decoration overrides/inheritance
 * Category 6: Clipping with decorated content
 * Category 7: Realistic UI patterns (card, button, badge)
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-decoration-combo-fixtures.ts
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
const OUTPUT_DIR = path.join(__dirname, "../fixtures/decoration-combo");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "decoration-combo.fig");

// =============================================================================
// Palette
// =============================================================================

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const DARK: FigColor = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
const BLUE: FigColor = { r: 0.2, g: 0.4, b: 0.9, a: 1 };
const RED: FigColor = { r: 0.9, g: 0.2, b: 0.2, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.95, g: 0.95, b: 0.95, a: 1 };

// =============================================================================
// Paint helpers
// =============================================================================

function solidPaint(color: FigColor, opacity = 1): FigPaint {
  return { type: "SOLID", color, opacity, visible: true, blendMode: "NORMAL" };
}

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

function gradientBlueToGreen(): FigPaint {
  return linearGradientPaint(0, [
    { position: 0, color: { r: 0.2, g: 0.4, b: 0.9, a: 1 } },
    { position: 1, color: { r: 0.2, g: 0.8, b: 0.5, a: 1 } },
  ]);
}

function gradientSunset(): FigPaint {
  return linearGradientPaint(135, [
    { position: 0, color: { r: 1.0, g: 0.4, b: 0.3, a: 1 } },
    { position: 0.5, color: { r: 0.9, g: 0.2, b: 0.5, a: 1 } },
    { position: 1, color: { r: 0.5, g: 0.2, b: 0.8, a: 1 } },
  ]);
}

function gradientRadialGlow(): FigPaint {
  return radialGradientPaint([
    { position: 0, color: { r: 1.0, g: 1.0, b: 0.8, a: 1 } },
    { position: 1, color: { r: 0.9, g: 0.5, b: 0.1, a: 1 } },
  ]);
}

function gradientVertical(): FigPaint {
  return linearGradientPaint(90, [
    { position: 0, color: { r: 0.95, g: 0.95, b: 1.0, a: 1 } },
    { position: 1, color: { r: 0.7, g: 0.7, b: 0.9, a: 1 } },
  ]);
}

// =============================================================================
// Effect helpers
// =============================================================================

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

function innerShadowEffect(opts: {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly color: FigColor;
}): FigEffect {
  return {
    type: "INNER_SHADOW",
    visible: true,
    color: opts.color,
    offset: { x: opts.offsetX, y: opts.offsetY },
    radius: opts.radius,
    blendMode: "NORMAL",
  };
}

function layerBlurEffect(radius: number): FigEffect {
  return { type: "LAYER_BLUR", visible: true, radius };
}

// =============================================================================
// BooleanOperation enum (canonical schema values)
// =============================================================================

type BooleanOp = "UNION" | "INTERSECT" | "SUBTRACT" | "XOR";

const BOOLEAN_OPERATION_VALUES: Record<BooleanOp, number> = {
  UNION: 0,
  INTERSECT: 1,
  SUBTRACT: 2,
  XOR: 3,
};

function booleanOperationEnum(op: BooleanOp): { value: number; name: BooleanOp } {
  return { value: BOOLEAN_OPERATION_VALUES[op], name: op };
}

// =============================================================================
// Frame / boolean helpers
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
};

function addFrame(
  doc: FigDesignDocument,
  ctx: Ctx,
  parentId: FigNodeId | null,
  opts: {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly background: FigColor;
    readonly clipsContent?: boolean;
    readonly cornerRadius?: number;
  },
): { readonly doc: FigDesignDocument; readonly id: FigNodeId } {
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: [solidPaint(opts.background)],
      clipsContent: opts.clipsContent ?? true,
      cornerRadius: opts.cornerRadius,
    },
  });
  return { doc: r.doc, id: r.nodeId };
}

// =============================================================================
// Fixture builders
// =============================================================================

type Args = { readonly doc: FigDesignDocument; readonly ctx: Ctx; readonly x: number; readonly y: number };
type Result = { readonly doc: FigDesignDocument };

function addGradientRadius({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-radius-linear", x, y, width: 180, height: 120, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "rounded-gradient",
      x: 20,
      y: 20,
      width: 140,
      height: 80,
      cornerRadius: 16,
      fills: [gradientBlueToGreen()],
    },
  });
  return { doc: r.doc };
}

function addGradientRadiusPill({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-radius-pill", x, y, width: 200, height: 80, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "pill-gradient",
      x: 20,
      y: 16,
      width: 160,
      height: 48,
      cornerRadius: 24,
      fills: [gradientRadialGlow()],
    },
  });
  return { doc: r.doc };
}

function addGradientRadiusCard({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-radius-card", x, y, width: 200, height: 140, background: LIGHT_GRAY });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "card-gradient",
      x: 20,
      y: 20,
      width: 160,
      height: 100,
      cornerRadius: 12,
      fills: [gradientSunset()],
    },
  });
  return { doc: r.doc };
}

function addGradientDropShadow({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-shadow-drop", x, y, width: 180, height: 140, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "gradient-shadowed",
      x: 25,
      y: 25,
      width: 120,
      height: 80,
      cornerRadius: 10,
      fills: [gradientBlueToGreen()],
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 6, radius: 12, color: { r: 0, g: 0, b: 0, a: 0.25 } })],
    },
  });
  return { doc: r.doc };
}

function addGradientInnerShadow({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-shadow-inner", x, y, width: 180, height: 140, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "gradient-inner-shadow",
      x: 30,
      y: 30,
      width: 120,
      height: 80,
      cornerRadius: 10,
      fills: [gradientVertical()],
      effects: [innerShadowEffect({ offsetX: 0, offsetY: 2, radius: 6, color: { r: 0, g: 0, b: 0, a: 0.15 } })],
    },
  });
  return { doc: r.doc };
}

function addGradientMultiEffect({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-multi-effect", x, y, width: 200, height: 160, background: LIGHT_GRAY });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "gradient-multi-fx",
      x: 30,
      y: 35,
      width: 140,
      height: 90,
      cornerRadius: 14,
      fills: [gradientSunset()],
      effects: [
        dropShadowEffect({ offsetX: 0, offsetY: 4, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.2 } }),
        dropShadowEffect({ offsetX: 0, offsetY: 12, radius: 24, color: { r: 0, g: 0, b: 0, a: 0.1 } }),
        innerShadowEffect({ offsetX: 0, offsetY: -2, radius: 4, color: { r: 1, g: 1, b: 1, a: 0.3 } }),
      ],
    },
  });
  return { doc: r.doc };
}

function addGradientBlur({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-blur", x, y, width: 160, height: 120, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ELLIPSE",
      name: "gradient-blur",
      x: 30,
      y: 10,
      width: 100,
      height: 100,
      fills: [gradientRadialGlow()],
      effects: [layerBlurEffect(4)],
    },
  });
  return { doc: r.doc };
}

function addGradientStrokeRadius({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-stroke-radius", x, y, width: 180, height: 120, background: WHITE });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "grad-stroke-rounded",
      x: 20,
      y: 20,
      width: 140,
      height: 80,
      cornerRadius: 12,
      fills: [gradientBlueToGreen()],
      strokes: [solidPaint(DARK)],
      strokeWeight: 2,
    },
  });
  return { doc: r.doc };
}

function addSolidStrokeRadiusShadow({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "solid-stroke-radius-shadow", x, y, width: 180, height: 140, background: LIGHT_GRAY });
  const r = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bordered-shadowed",
      x: 25,
      y: 25,
      width: 120,
      height: 80,
      cornerRadius: 8,
      fills: [solidPaint(WHITE)],
      strokes: [solidPaint(BLUE)],
      strokeWeight: 2,
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 4, radius: 10, color: { r: 0, g: 0, b: 0, a: 0.15 } })],
    },
  });
  return { doc: r.doc };
}

function addBooleanGradient({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "bool-gradient-union", x, y, width: 200, height: 150, background: WHITE });
  const bo = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "BOOLEAN_OPERATION",
      name: "gradient-union",
      x: 30,
      y: 25,
      width: 140,
      height: 100,
      booleanOperation: booleanOperationEnum("UNION"),
      fills: [gradientSunset()],
    },
  });
  const child1 = addNode({
    state: ctx.state,
    doc: bo.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ROUNDED_RECTANGLE", name: "base", x: 0, y: 15, width: 100, height: 70, cornerRadius: 10 },
  });
  const child2 = addNode({
    state: ctx.state,
    doc: child1.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ELLIPSE", name: "circle", x: 60, y: 0, width: 70, height: 70 },
  });
  return { doc: child2.doc };
}

function addBooleanGradientShadow({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "bool-gradient-subtract-shadow", x, y, width: 200, height: 160, background: LIGHT_GRAY });
  const bo = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "BOOLEAN_OPERATION",
      name: "gradient-subtract",
      x: 40,
      y: 35,
      width: 120,
      height: 90,
      booleanOperation: booleanOperationEnum("SUBTRACT"),
      fills: [gradientBlueToGreen()],
    },
  });
  const child1 = addNode({
    state: ctx.state,
    doc: bo.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ROUNDED_RECTANGLE", name: "outer", x: 0, y: 0, width: 120, height: 90, cornerRadius: 12 },
  });
  const child2 = addNode({
    state: ctx.state,
    doc: child1.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ELLIPSE", name: "hole", x: 40, y: 25, width: 40, height: 40 },
  });
  return { doc: child2.doc };
}

function addBooleanRoundedOperands({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "bool-rounded-operands", x, y, width: 200, height: 150, background: WHITE });
  const bo = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "BOOLEAN_OPERATION",
      name: "rounded-subtract",
      x: 30,
      y: 25,
      width: 140,
      height: 100,
      booleanOperation: booleanOperationEnum("SUBTRACT"),
      fills: [solidPaint(BLUE)],
    },
  });
  const child1 = addNode({
    state: ctx.state,
    doc: bo.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ROUNDED_RECTANGLE", name: "outer-rounded", x: 0, y: 0, width: 140, height: 100, cornerRadius: 20 },
  });
  const child2 = addNode({
    state: ctx.state,
    doc: child1.doc,
    pageId: ctx.pageId,
    parentId: bo.nodeId,
    spec: { type: "ROUNDED_RECTANGLE", name: "inner-rounded", x: 20, y: 20, width: 100, height: 60, cornerRadius: 10 },
  });
  return { doc: child2.doc };
}

function addInstanceDecorationInherit({ doc, ctx, x, y }: Args): Result {
  // Symbol with gradient + radius + shadow, then instances inheriting.
  const sym = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "CardSymbol",
      x: x - 200,
      y,
      width: 140,
      height: 80,
      fills: [solidPaint(WHITE)],
    },
  });
  const symWithRadius = updateNode({
    doc: sym.doc,
    pageId: ctx.pageId,
    nodeId: sym.nodeId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const symChild = addNode({
    state: ctx.state,
    doc: symWithRadius,
    pageId: ctx.pageId,
    parentId: sym.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bg",
      x: 0,
      y: 0,
      width: 140,
      height: 80,
      cornerRadius: 12,
      fills: [gradientBlueToGreen()],
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 4, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.2 } })],
    },
  });
  const frame = addFrame(symChild.doc, ctx, null, {
    name: "instance-inherit-decoration",
    x,
    y,
    width: 360,
    height: 120,
    background: LIGHT_GRAY,
  });
  const inst1 = addNode({
    state: ctx.state,
    doc: frame.doc,
    pageId: ctx.pageId,
    parentId: frame.id,
    spec: { type: "INSTANCE", name: "inherited", symbolId: sym.nodeId, x: 10, y: 20, width: 140, height: 80 },
  });
  const inst2 = addNode({
    state: ctx.state,
    doc: inst1.doc,
    pageId: ctx.pageId,
    parentId: frame.id,
    spec: { type: "INSTANCE", name: "inherited-2", symbolId: sym.nodeId, x: 170, y: 20, width: 140, height: 80 },
  });
  return { doc: inst2.doc };
}

function addInstanceGradientOverride({ doc, ctx, x, y }: Args): Result {
  const sym = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "ButtonSymbol",
      x: x - 200,
      y: y + 200,
      width: 120,
      height: 44,
      fills: [solidPaint(BLUE)],
    },
  });
  const symWithRadius = updateNode({
    doc: sym.doc,
    pageId: ctx.pageId,
    nodeId: sym.nodeId,
    updater: (n) => ({ ...n, cornerRadius: 8 }),
  });
  const symChild = addNode({
    state: ctx.state,
    doc: symWithRadius,
    pageId: ctx.pageId,
    parentId: sym.nodeId,
    spec: { type: "ROUNDED_RECTANGLE", name: "btn-bg", x: 0, y: 0, width: 120, height: 44, cornerRadius: 8, fills: [solidPaint(BLUE)] },
  });
  const frame = addFrame(symChild.doc, ctx, null, {
    name: "instance-gradient-override",
    x,
    y,
    width: 300,
    height: 100,
    background: WHITE,
  });
  const inst1 = addNode({
    state: ctx.state,
    doc: frame.doc,
    pageId: ctx.pageId,
    parentId: frame.id,
    spec: { type: "INSTANCE", name: "solid-default", symbolId: sym.nodeId, x: 15, y: 28, width: 120, height: 44 },
  });
  const inst2 = addNode({
    state: ctx.state,
    doc: inst1.doc,
    pageId: ctx.pageId,
    parentId: frame.id,
    spec: { type: "INSTANCE", name: "gradient-override", symbolId: sym.nodeId, x: 160, y: 28, width: 120, height: 44 },
  });
  return { doc: inst2.doc };
}

function addClipGradient({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "clip-gradient-rounded", x, y, width: 160, height: 120, background: WHITE });
  const clip = addFrame(f.doc, ctx, f.id, {
    name: "clip-frame",
    x: 20,
    y: 20,
    width: 120,
    height: 80,
    background: WHITE,
    cornerRadius: 16,
  });
  const grad = addNode({
    state: ctx.state,
    doc: clip.doc,
    pageId: ctx.pageId,
    parentId: clip.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "overflow-gradient",
      x: -20,
      y: -20,
      width: 160,
      height: 120,
      fills: [gradientSunset()],
    },
  });
  return { doc: grad.doc };
}

function addClipShadow({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "clip-shadow", x, y, width: 160, height: 140, background: LIGHT_GRAY });
  const clip = addFrame(f.doc, ctx, f.id, {
    name: "clip-boundary",
    x: 20,
    y: 20,
    width: 120,
    height: 100,
    background: LIGHT_GRAY,
  });
  const shape = addNode({
    state: ctx.state,
    doc: clip.doc,
    pageId: ctx.pageId,
    parentId: clip.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "near-edge",
      x: 30,
      y: 30,
      width: 80,
      height: 60,
      cornerRadius: 8,
      fills: [solidPaint(BLUE)],
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 8, radius: 16, color: { r: 0, g: 0, b: 0, a: 0.3 } })],
    },
  });
  return { doc: shape.doc };
}

function addRealisticCard({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "realistic-card", x, y, width: 240, height: 180, background: LIGHT_GRAY });
  const card = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "card-body",
      x: 20,
      y: 20,
      width: 200,
      height: 140,
      cornerRadius: 16,
      fills: [linearGradientPaint(180, [
        { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
        { position: 1, color: { r: 0.96, g: 0.96, b: 0.98, a: 1 } },
      ])],
      strokes: [solidPaint({ r: 0.85, g: 0.85, b: 0.9, a: 1 })],
      strokeWeight: 1,
      effects: [
        dropShadowEffect({ offsetX: 0, offsetY: 1, radius: 3, color: { r: 0, g: 0, b: 0, a: 0.08 } }),
        dropShadowEffect({ offsetX: 0, offsetY: 6, radius: 16, color: { r: 0, g: 0, b: 0, a: 0.06 } }),
      ],
    },
  });
  return { doc: card.doc };
}

function addRealisticBadge({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "realistic-badge", x, y, width: 140, height: 60, background: WHITE });
  const badge = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "badge",
      x: 20,
      y: 14,
      width: 100,
      height: 32,
      cornerRadius: 16,
      fills: [linearGradientPaint(0, [
        { position: 0, color: { r: 0.3, g: 0.7, b: 1.0, a: 1 } },
        { position: 1, color: { r: 0.2, g: 0.5, b: 0.9, a: 1 } },
      ])],
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 2, radius: 4, color: { r: 0.2, g: 0.4, b: 0.8, a: 0.3 } })],
    },
  });
  return { doc: badge.doc };
}

function addRealisticAvatar({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "realistic-avatar", x, y, width: 120, height: 120, background: LIGHT_GRAY });
  const avatar = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ELLIPSE",
      name: "avatar",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
      fills: [radialGradientPaint([
        { position: 0, color: { r: 0.9, g: 0.7, b: 0.5, a: 1 } },
        { position: 1, color: { r: 0.6, g: 0.3, b: 0.2, a: 1 } },
      ])],
      strokes: [solidPaint(WHITE)],
      strokeWeight: 3,
      effects: [dropShadowEffect({ offsetX: 0, offsetY: 2, radius: 6, color: { r: 0, g: 0, b: 0, a: 0.2 } })],
    },
  });
  return { doc: avatar.doc };
}

function addGradientOpacity({ doc, ctx, x, y }: Args): Result {
  const f = addFrame(doc, ctx, null, { name: "grad-opacity", x, y, width: 160, height: 120, background: LIGHT_GRAY });
  const bg = addNode({
    state: ctx.state,
    doc: f.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bg-solid",
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      fills: [solidPaint(RED)],
    },
  });
  const overlay = addNode({
    state: ctx.state,
    doc: bg.doc,
    pageId: ctx.pageId,
    parentId: f.id,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "gradient-overlay",
      x: 40,
      y: 30,
      width: 100,
      height: 60,
      cornerRadius: 8,
      fills: [gradientBlueToGreen()],
      opacity: 0.6,
    },
  });
  return { doc: overlay.doc };
}

// =============================================================================
// Main
// =============================================================================

async function generate(): Promise<void> {
  console.log("Generating decoration combination fixtures...\n");

  const empty = createEmptyFigDesignDocument("DecorationCombo");
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
  const COL_WIDTH = 280;
  const ROW_HEIGHT = 200;
  const MARGIN = 50;

  type Builder = (args: Args) => Result;
  const builders: { name: string; fn: Builder }[] = [
    // Category 1
    { name: "Gradient + Linear Radius", fn: addGradientRadius },
    { name: "Gradient + Pill Radius", fn: addGradientRadiusPill },
    { name: "Gradient + Card Radius", fn: addGradientRadiusCard },
    // Category 2
    { name: "Gradient + Drop Shadow", fn: addGradientDropShadow },
    { name: "Gradient + Inner Shadow", fn: addGradientInnerShadow },
    { name: "Gradient + Multi Effects", fn: addGradientMultiEffect },
    { name: "Gradient + Blur", fn: addGradientBlur },
    // Category 3
    { name: "Gradient + Stroke + Radius", fn: addGradientStrokeRadius },
    { name: "Solid + Stroke + Radius + Shadow", fn: addSolidStrokeRadiusShadow },
    // Category 4
    { name: "Boolean Gradient Union", fn: addBooleanGradient },
    { name: "Boolean Gradient Subtract + Shadow", fn: addBooleanGradientShadow },
    { name: "Boolean Rounded Operands", fn: addBooleanRoundedOperands },
    // Category 5
    { name: "Instance Decoration Inherit", fn: addInstanceDecorationInherit },
    { name: "Instance Gradient Override", fn: addInstanceGradientOverride },
    // Category 6
    { name: "Clip + Gradient Rounded", fn: addClipGradient },
    { name: "Clip + Shadow", fn: addClipShadow },
    // Category 7
    { name: "Realistic Card", fn: addRealisticCard },
    { name: "Realistic Badge", fn: addRealisticBadge },
    { name: "Realistic Avatar", fn: addRealisticAvatar },
    { name: "Gradient + Opacity", fn: addGradientOpacity },
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
