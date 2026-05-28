#!/usr/bin/env bun
/**
 * @file Generate constraint-edge-cases fixture .fig file
 *
 * Edge-case tests for constraint resolution:
 *
 * Canvas 1 — "Nested Constraints":  Cascading constraint resolution through nested instances
 * Canvas 2 — "Variant + Resize":    overriddenSymbolID combined with resize + constraints
 * Canvas 3 — "Ellipse Constraints": Constraint resolution on ELLIPSE nodes
 * Canvas 4 — "Asymmetric STRETCH":  Unequal margins with STRETCH constraint (grow & shrink)
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-constraint-edge-cases-fixtures.ts
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
  type KiwiChildLayoutFields,
  type SolidPaintSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { CONSTRAINT_TYPE_VALUES, type ConstraintType } from "@higma-document-models/fig/constants";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/constraint-edge-cases");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "constraint-edge-cases.fig");

// =============================================================================
// Colors
// =============================================================================

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const IOS_BLUE: FigColor = { r: 0, g: 0.478, b: 1, a: 1 };
const IOS_GREEN: FigColor = { r: 0.204, g: 0.78, b: 0.349, a: 1 };
const IOS_RED: FigColor = { r: 1, g: 0.231, b: 0.188, a: 1 };
const IOS_ORANGE: FigColor = { r: 1, g: 0.584, b: 0, a: 1 };
const IOS_PURPLE: FigColor = { r: 0.686, g: 0.322, b: 0.871, a: 1 };
const IOS_GRAY_BG: FigColor = { r: 0.949, g: 0.949, b: 0.969, a: 1 };

function solidPaint(color: FigColor): SolidPaintSpec {
  return { type: "SOLID", color, opacity: 1, visible: true };
}

function constraintsFor(h: ConstraintType, v: ConstraintType): KiwiChildLayoutFields {
  return {
    horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES[h], name: h },
    verticalConstraint: { value: CONSTRAINT_TYPE_VALUES[v], name: v },
  };
}

type State = ReturnType<typeof createFigBuilderState>;

type Ctx = {
  readonly state: State;
  readonly pageGuid: FigGuid;
};

type FrameOpts = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bg: FigColor;
};

function addTestFrame(
  ctx: Ctx, context: FigDocumentContext, opts: FrameOpts,
): { readonly context: FigDocumentContext; readonly frameId: FigGuid } {
  const r = addNode({
    state: ctx.state, context, pageGuid: ctx.pageGuid, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: opts.name,
      x: opts.x, y: opts.y, width: opts.width, height: opts.height,
      fills: [solidPaint(opts.bg)],
      clipsContent: true,
    },
  });
  return { context: r.context, frameId: r.nodeGuid };
}

async function generate(): Promise<void> {
  console.log("Generating constraint-edge-cases fixtures...\n");

  const empty = createEmptyFigDocument("Nested Constraints");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid1 = requireCanvas(empty.document, "Nested Constraints").guid;
  const r1 = addPage({ state, context: empty, name: "Variant + Resize" });
  const pageGuid2 = r1.pageGuid;
  const r2 = addPage({ state, context: r1.context, name: "Ellipse Constraints" });
  const pageGuid3 = r2.pageGuid;
  const r3 = addPage({ state, context: r2.context, name: "Asymmetric STRETCH" });
  const pageGuid4 = r3.pageGuid;
  const r4 = addPage({ state, context: r3.context, name: "Internal Only Canvas", internalOnly: true });

  const ctx1: Ctx = { state, pageGuid: pageGuid1 };
  const ctx2: Ctx = { state, pageGuid: pageGuid2 };
  const ctx3: Ctx = { state, pageGuid: pageGuid3 };
  const ctx4: Ctx = { state, pageGuid: pageGuid4 };

  // =========================================================================
  // Canvas 1: Nested Constraints
  // =========================================================================

  // NestInner SYMBOL
  const nestInner = addNode({
    state, context: r4.context, pageGuid: pageGuid1, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: "NestInner",
      x: 0, y: -600, width: 160, height: 80,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const nestInnerId = nestInner.nodeGuid;
  const d_nestInner = updateNode({
    context: nestInner.context, nodeGuid: nestInnerId,
    update: (n) => ({ ...n, cornerRadius: 8 }),
  });
  const niChild = addNode({
    state, context: d_nestInner, pageGuid: pageGuid1, parentGuid: nestInnerId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE",
      name: "inner-rect",
      x: 20, y: 20, width: 120, height: 40,
      fills: [solidPaint(IOS_BLUE)],
      cornerRadius: 6,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // NestOuter SYMBOL
  const nestOuter = addNode({
    state, context: niChild.context, pageGuid: pageGuid1, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: "NestOuter",
      x: 300, y: -600, width: 300, height: 200,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const nestOuterId = nestOuter.nodeGuid;
  const d_nestOuter = updateNode({
    context: nestOuter.context, nodeGuid: nestOuterId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const noInst = addNode({
    state, context: d_nestOuter, pageGuid: pageGuid1, parentGuid: nestOuterId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE",
      name: "inner-instance",
      symbolId: nestInnerId,
      x: 70, y: 60, width: 160, height: 80,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // Test frames for Canvas 1
  const c1_f1 = addTestFrame(ctx1, noInst.context, {
    name: "nested-stretch-grow", x: 50, y: 50, width: 420, height: 300, bg: WHITE,
  });
  const c1_f1_inst = addNode({
    state, context: c1_f1.context, pageGuid: pageGuid1, parentGuid: c1_f1.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "NestOuter-large", symbolId: nestOuterId,
      x: 10, y: 10, width: 400, height: 280,
    },
  });

  const c1_f2 = addTestFrame(ctx1, c1_f1_inst.context, {
    name: "nested-stretch-shrink", x: 500, y: 50, width: 220, height: 160, bg: WHITE,
  });
  const c1_f2_inst = addNode({
    state, context: c1_f2.context, pageGuid: pageGuid1, parentGuid: c1_f2.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "NestOuter-small", symbolId: nestOuterId,
      x: 10, y: 10, width: 200, height: 140,
    },
  });

  const c1_f3 = addTestFrame(ctx1, c1_f2_inst.context, {
    name: "nested-same-size", x: 50, y: 380, width: 320, height: 220, bg: WHITE,
  });
  const contextAfterC1 = addNode({
    state, context: c1_f3.context, pageGuid: pageGuid1, parentGuid: c1_f3.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "NestOuter-same", symbolId: nestOuterId,
      x: 10, y: 10, width: 300, height: 200,
    },
  }).context;

  // =========================================================================
  // Canvas 2: Variant + Resize
  // =========================================================================
  const varBtnDefault = addNode({
    state, context: contextAfterC1, pageGuid: pageGuid2, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "VarBtnDefault",
      x: 0, y: -600, width: 120, height: 48,
      fills: [solidPaint(IOS_BLUE)],
      clipsContent: true,
    },
  });
  const varBtnDefaultId = varBtnDefault.nodeGuid;
  const d_vbd = updateNode({
    context: varBtnDefault.context, nodeGuid: varBtnDefaultId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const vbdLabel = addNode({
    state, context: d_vbd, pageGuid: pageGuid2, parentGuid: varBtnDefaultId,
    spec: {
      visible: true,
      type: "ROUNDED_RECTANGLE", name: "label",
      x: 20, y: 12, width: 80, height: 24,
      fills: [solidPaint(WHITE)],
      opacity: 0.2,
      cornerRadius: 4,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const varBtnActive = addNode({
    state, context: vbdLabel.context, pageGuid: pageGuid2, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "VarBtnActive",
      x: 200, y: -600, width: 120, height: 48,
      fills: [solidPaint(IOS_GREEN)],
      clipsContent: true,
    },
  });
  const varBtnActiveId = varBtnActive.nodeGuid;
  const d_vba = updateNode({
    context: varBtnActive.context, nodeGuid: varBtnActiveId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const vbaLabel = addNode({
    state, context: d_vba, pageGuid: pageGuid2, parentGuid: varBtnActiveId,
    spec: {
      visible: true,
      type: "ROUNDED_RECTANGLE", name: "label",
      x: 20, y: 12, width: 80, height: 24,
      fills: [solidPaint(WHITE)],
      opacity: 0.3,
      cornerRadius: 4,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // Test frames
  const c2_f1 = addTestFrame(ctx2, vbaLabel.context, {
    name: "variant-resize-default", x: 50, y: 50, width: 220, height: 80, bg: WHITE,
  });
  const c2_f1_inst = addNode({
    state, context: c2_f1.context, pageGuid: pageGuid2, parentGuid: c2_f1.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "VarBtnDefault-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });

  // Variant resize override — overriddenSymbolID via updateNode
  const c2_f2 = addTestFrame(ctx2, c2_f1_inst.context, {
    name: "variant-resize-override", x: 300, y: 50, width: 220, height: 80, bg: WHITE,
  });
  const c2_f2_inst = addNode({
    state, context: c2_f2.context, pageGuid: pageGuid2, parentGuid: c2_f2.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "VarBtnActive-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });
  const d_c2_f2_inst = updateNode({
    context: c2_f2_inst.context, nodeGuid: c2_f2_inst.nodeGuid,
    update: (n) => ({ ...n, overriddenSymbolID: varBtnActiveId }),
  });

  // Side by side both
  const c2_f3 = addTestFrame(ctx2, d_c2_f2_inst, {
    name: "variant-resize-both", x: 50, y: 160, width: 440, height: 80, bg: IOS_GRAY_BG,
  });
  const c2_f3_def = addNode({
    state, context: c2_f3.context, pageGuid: pageGuid2, parentGuid: c2_f3.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "default-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });
  const c2_f3_active = addNode({
    state, context: c2_f3_def.context, pageGuid: pageGuid2, parentGuid: c2_f3.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "active-wide", symbolId: varBtnDefaultId,
      x: 230, y: 10, width: 200, height: 60,
    },
  });
  const contextAfterC2 = updateNode({
    context: c2_f3_active.context, nodeGuid: c2_f3_active.nodeGuid,
    update: (n) => ({ ...n, overriddenSymbolID: varBtnActiveId }),
  });

  // =========================================================================
  // Canvas 3: Ellipse Constraints
  // =========================================================================
  const ellipseBox = addNode({
    state, context: contextAfterC2, pageGuid: pageGuid3, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "EllipseBox",
      x: 0, y: -600, width: 200, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const ellipseBoxId = ellipseBox.nodeGuid;
  const d_eb = updateNode({
    context: ellipseBox.context, nodeGuid: ellipseBoxId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const ebCenter = addNode({
    state, context: d_eb, pageGuid: pageGuid3, parentGuid: ellipseBoxId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ELLIPSE", name: "center-ellipse",
      x: 70, y: 40, width: 60, height: 40,
      fills: [solidPaint(IOS_PURPLE)],
      ...constraintsFor("CENTER", "CENTER"),
    },
  });
  const ebStretch = addNode({
    state, context: ebCenter.context, pageGuid: pageGuid3, parentGuid: ellipseBoxId,
    spec: {
      visible: true,
      type: "ELLIPSE", name: "stretch-ellipse",
      x: 20, y: 20, width: 160, height: 80,
      fills: [solidPaint(IOS_ORANGE)],
      opacity: 0.5,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const ellipseScaleBox = addNode({
    state, context: ebStretch.context, pageGuid: pageGuid3, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "EllipseScaleBox",
      x: 300, y: -600, width: 200, height: 120,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const ellipseScaleBoxId = ellipseScaleBox.nodeGuid;
  const d_esb = updateNode({
    context: ellipseScaleBox.context, nodeGuid: ellipseScaleBoxId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const esChild = addNode({
    state, context: d_esb, pageGuid: pageGuid3, parentGuid: ellipseScaleBoxId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ELLIPSE", name: "scaled-ellipse",
      x: 50, y: 30, width: 100, height: 60,
      fills: [solidPaint(IOS_RED)],
      ...constraintsFor("SCALE", "SCALE"),
    },
  });

  const c3_f1 = addTestFrame(ctx3, esChild.context, {
    name: "ellipse-center-stretch-grow", x: 50, y: 50, width: 320, height: 200, bg: IOS_GRAY_BG,
  });
  const c3_f1_inst = addNode({
    state, context: c3_f1.context, pageGuid: pageGuid3, parentGuid: c3_f1.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "EllipseBox-large", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 300, height: 180,
    },
  });
  const c3_f2 = addTestFrame(ctx3, c3_f1_inst.context, {
    name: "ellipse-center-stretch-shrink", x: 400, y: 50, width: 180, height: 120, bg: IOS_GRAY_BG,
  });
  const c3_f2_inst = addNode({
    state, context: c3_f2.context, pageGuid: pageGuid3, parentGuid: c3_f2.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "EllipseBox-small", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 160, height: 100,
    },
  });
  const c3_f3 = addTestFrame(ctx3, c3_f2_inst.context, {
    name: "ellipse-scale", x: 50, y: 280, width: 320, height: 200, bg: WHITE,
  });
  const c3_f3_inst = addNode({
    state, context: c3_f3.context, pageGuid: pageGuid3, parentGuid: c3_f3.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "EllipseScale-large", symbolId: ellipseScaleBoxId,
      x: 10, y: 10, width: 300, height: 180,
    },
  });
  const c3_f4 = addTestFrame(ctx3, c3_f3_inst.context, {
    name: "ellipse-same-size", x: 400, y: 280, width: 220, height: 140, bg: WHITE,
  });
  const contextAfterC3 = addNode({
    state, context: c3_f4.context, pageGuid: pageGuid3, parentGuid: c3_f4.frameId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "EllipseBox-same", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 200, height: 120,
    },
  }).context;

  // =========================================================================
  // Canvas 4: Asymmetric STRETCH
  // =========================================================================
  const asymBox = addNode({
    state, context: contextAfterC3, pageGuid: pageGuid4, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "AsymBox",
      x: 0, y: -600, width: 200, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const asymBoxId = asymBox.nodeGuid;
  const d_ab = updateNode({
    context: asymBox.context, nodeGuid: asymBoxId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const abChild = addNode({
    state, context: d_ab, pageGuid: pageGuid4, parentGuid: asymBoxId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE", name: "asym-rect",
      x: 10, y: 15, width: 140, height: 70,
      fills: [solidPaint(IOS_RED)],
      cornerRadius: 6,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const asymBoxWide = addNode({
    state, context: abChild.context, pageGuid: pageGuid4, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "AsymBoxWide",
      x: 300, y: -600, width: 300, height: 100,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const asymBoxWideId = asymBoxWide.nodeGuid;
  const d_abw = updateNode({
    context: asymBoxWide.context, nodeGuid: asymBoxWideId,
    update: (n) => ({ ...n, cornerRadius: 8 }),
  });
  const abwChild = addNode({
    state, context: d_abw, pageGuid: pageGuid4, parentGuid: asymBoxWideId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE", name: "wide-rect",
      x: 30, y: 10, width: 200, height: 50,
      fills: [solidPaint(IOS_GREEN)],
      cornerRadius: 4,
      ...constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const asymMulti = addNode({
    state, context: abwChild.context, pageGuid: pageGuid4, parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL", name: "AsymMultiChild",
      x: 600, y: -600, width: 240, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const asymMultiId = asymMulti.nodeGuid;
  const d_am = updateNode({
    context: asymMulti.context, nodeGuid: asymMultiId,
    update: (n) => ({ ...n, cornerRadius: 10 }),
  });
  const amcChild1 = addNode({
    state, context: d_am, pageGuid: pageGuid4, parentGuid: asymMultiId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE", name: "left-rect",
      x: 10, y: 10, width: 100, height: 40,
      fills: [solidPaint(IOS_BLUE)],
      cornerRadius: 4,
      ...constraintsFor("STRETCH", "MIN"),
    },
  });
  const amcChild2 = addNode({
    state, context: amcChild1.context, pageGuid: pageGuid4, parentGuid: asymMultiId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE", name: "right-rect",
      x: 130, y: 70, width: 100, height: 40,
      fills: [solidPaint(IOS_ORANGE)],
      cornerRadius: 4,
      ...constraintsFor("STRETCH", "MAX"),
    },
  });

  // Test frames
  const c4_f1 = addTestFrame(ctx4, amcChild2.context, {
    name: "asym-stretch-grow", x: 50, y: 50, width: 340, height: 220, bg: IOS_GRAY_BG,
  });
  const c4_f1_inst = addNode({
    state, context: c4_f1.context, pageGuid: pageGuid4, parentGuid: c4_f1.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymBox-large", symbolId: asymBoxId, x: 10, y: 10, width: 320, height: 200 },
  });
  const c4_f2 = addTestFrame(ctx4, c4_f1_inst.context, {
    name: "asym-stretch-shrink", x: 420, y: 50, width: 140, height: 100, bg: IOS_GRAY_BG,
  });
  const c4_f2_inst = addNode({
    state, context: c4_f2.context, pageGuid: pageGuid4, parentGuid: c4_f2.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymBox-small", symbolId: asymBoxId, x: 10, y: 10, width: 120, height: 80 },
  });
  const c4_f3 = addTestFrame(ctx4, c4_f2_inst.context, {
    name: "asym-wide-grow", x: 50, y: 300, width: 420, height: 160, bg: WHITE,
  });
  const c4_f3_inst = addNode({
    state, context: c4_f3.context, pageGuid: pageGuid4, parentGuid: c4_f3.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymBoxWide-large", symbolId: asymBoxWideId, x: 10, y: 10, width: 400, height: 140 },
  });
  const c4_f4 = addTestFrame(ctx4, c4_f3_inst.context, {
    name: "asym-wide-shrink", x: 500, y: 300, width: 220, height: 80, bg: WHITE,
  });
  const c4_f4_inst = addNode({
    state, context: c4_f4.context, pageGuid: pageGuid4, parentGuid: c4_f4.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymBoxWide-small", symbolId: asymBoxWideId, x: 10, y: 10, width: 200, height: 60 },
  });
  const c4_f5 = addTestFrame(ctx4, c4_f4_inst.context, {
    name: "asym-multi-grow", x: 50, y: 490, width: 380, height: 200, bg: IOS_GRAY_BG,
  });
  const c4_f5_inst = addNode({
    state, context: c4_f5.context, pageGuid: pageGuid4, parentGuid: c4_f5.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymMulti-large", symbolId: asymMultiId, x: 10, y: 10, width: 360, height: 180 },
  });
  const c4_f6 = addTestFrame(ctx4, c4_f5_inst.context, {
    name: "asym-multi-shrink", x: 460, y: 490, width: 200, height: 120, bg: IOS_GRAY_BG,
  });
  const c4_f6_inst = addNode({
    state, context: c4_f6.context, pageGuid: pageGuid4, parentGuid: c4_f6.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymMulti-small", symbolId: asymMultiId, x: 10, y: 10, width: 180, height: 100 },
  });
  const c4_f7 = addTestFrame(ctx4, c4_f6_inst.context, {
    name: "asym-same-size", x: 50, y: 720, width: 220, height: 140, bg: WHITE,
  });
  const finalContext = addNode({
    state, context: c4_f7.context, pageGuid: pageGuid4, parentGuid: c4_f7.frameId,
    spec: {
  visible: true,
  opacity: 1, type: "INSTANCE", name: "AsymBox-same", symbolId: asymBoxId, x: 10, y: 10, width: 200, height: 120 },
  }).context;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  for (const subdir of ["actual", "snapshots"]) {
    const dir = path.join(OUTPUT_DIR, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.byteLength / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
