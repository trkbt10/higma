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
  createEmptyFigDesignDocument,
  exportFig,
  updateNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
  LayoutConstraints,
} from "@higma-document-models/fig/domain";
import { CONSTRAINT_TYPE_VALUES, type ConstraintType } from "@higma-document-models/fig/constants";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";

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

function solidPaint(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true, blendMode: "NORMAL" };
}

function constraintsFor(h: ConstraintType, v: ConstraintType): LayoutConstraints {
  return {
    horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES[h], name: h },
    verticalConstraint: { value: CONSTRAINT_TYPE_VALUES[v], name: v },
  };
}

type State = ReturnType<typeof createFigBuilderState>;

type Ctx = {
  readonly state: State;
  readonly pageId: FigPageId;
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
  ctx: Ctx, doc: FigDesignDocument, opts: FrameOpts,
): { readonly doc: FigDesignDocument; readonly frameId: FigNodeId } {
  const r = addNode({
    state: ctx.state, doc, pageId: ctx.pageId, parentId: null,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: opts.x, y: opts.y, width: opts.width, height: opts.height,
      fills: [solidPaint(opts.bg)],
      clipsContent: true,
    },
  });
  return { doc: r.doc, frameId: r.nodeId };
}

async function generate(): Promise<void> {
  console.log("Generating constraint-edge-cases fixtures...\n");

  const empty = createEmptyFigDesignDocument("Nested Constraints");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId1 = empty.pages[0]!.id;
  const r1 = addPage({ state, doc: empty, name: "Variant + Resize" });
  const pageId2 = r1.pageId;
  const r2 = addPage({ state, doc: r1.doc, name: "Ellipse Constraints" });
  const pageId3 = r2.pageId;
  const r3 = addPage({ state, doc: r2.doc, name: "Asymmetric STRETCH" });
  const pageId4 = r3.pageId;
  const r4 = addPage({ state, doc: r3.doc, name: "Internal Only Canvas", internalOnly: true });

  const ctx1: Ctx = { state, pageId: pageId1 };
  const ctx2: Ctx = { state, pageId: pageId2 };
  const ctx3: Ctx = { state, pageId: pageId3 };
  const ctx4: Ctx = { state, pageId: pageId4 };

  // =========================================================================
  // Canvas 1: Nested Constraints
  // =========================================================================

  // NestInner SYMBOL
  const nestInner = addNode({
    state, doc: r4.doc, pageId: pageId1, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "NestInner",
      x: 0, y: -600, width: 160, height: 80,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const nestInnerId = nestInner.nodeId;
  const d_nestInner = updateNode({
    doc: nestInner.doc, pageId: pageId1, nodeId: nestInnerId,
    updater: (n) => ({ ...n, cornerRadius: 8 }),
  });
  const niChild = addNode({
    state, doc: d_nestInner, pageId: pageId1, parentId: nestInnerId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "inner-rect",
      x: 20, y: 20, width: 120, height: 40,
      fills: [solidPaint(IOS_BLUE)],
      cornerRadius: 6,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // NestOuter SYMBOL
  const nestOuter = addNode({
    state, doc: niChild.doc, pageId: pageId1, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "NestOuter",
      x: 300, y: -600, width: 300, height: 200,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const nestOuterId = nestOuter.nodeId;
  const d_nestOuter = updateNode({
    doc: nestOuter.doc, pageId: pageId1, nodeId: nestOuterId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const noInst = addNode({
    state, doc: d_nestOuter, pageId: pageId1, parentId: nestOuterId,
    spec: {
      type: "INSTANCE",
      name: "inner-instance",
      symbolId: nestInnerId,
      x: 70, y: 60, width: 160, height: 80,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // Test frames for Canvas 1
  const c1_f1 = addTestFrame(ctx1, noInst.doc, {
    name: "nested-stretch-grow", x: 50, y: 50, width: 420, height: 300, bg: WHITE,
  });
  const c1_f1_inst = addNode({
    state, doc: c1_f1.doc, pageId: pageId1, parentId: c1_f1.frameId,
    spec: {
      type: "INSTANCE", name: "NestOuter-large", symbolId: nestOuterId,
      x: 10, y: 10, width: 400, height: 280,
    },
  });

  const c1_f2 = addTestFrame(ctx1, c1_f1_inst.doc, {
    name: "nested-stretch-shrink", x: 500, y: 50, width: 220, height: 160, bg: WHITE,
  });
  const c1_f2_inst = addNode({
    state, doc: c1_f2.doc, pageId: pageId1, parentId: c1_f2.frameId,
    spec: {
      type: "INSTANCE", name: "NestOuter-small", symbolId: nestOuterId,
      x: 10, y: 10, width: 200, height: 140,
    },
  });

  const c1_f3 = addTestFrame(ctx1, c1_f2_inst.doc, {
    name: "nested-same-size", x: 50, y: 380, width: 320, height: 220, bg: WHITE,
  });
  const docAfterC1 = addNode({
    state, doc: c1_f3.doc, pageId: pageId1, parentId: c1_f3.frameId,
    spec: {
      type: "INSTANCE", name: "NestOuter-same", symbolId: nestOuterId,
      x: 10, y: 10, width: 300, height: 200,
    },
  }).doc;

  // =========================================================================
  // Canvas 2: Variant + Resize
  // =========================================================================
  const varBtnDefault = addNode({
    state, doc: docAfterC1, pageId: pageId2, parentId: null,
    spec: {
      type: "SYMBOL", name: "VarBtnDefault",
      x: 0, y: -600, width: 120, height: 48,
      fills: [solidPaint(IOS_BLUE)],
      clipsContent: true,
    },
  });
  const varBtnDefaultId = varBtnDefault.nodeId;
  const d_vbd = updateNode({
    doc: varBtnDefault.doc, pageId: pageId2, nodeId: varBtnDefaultId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const vbdLabel = addNode({
    state, doc: d_vbd, pageId: pageId2, parentId: varBtnDefaultId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "label",
      x: 20, y: 12, width: 80, height: 24,
      fills: [solidPaint(WHITE)],
      opacity: 0.2,
      cornerRadius: 4,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const varBtnActive = addNode({
    state, doc: vbdLabel.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "SYMBOL", name: "VarBtnActive",
      x: 200, y: -600, width: 120, height: 48,
      fills: [solidPaint(IOS_GREEN)],
      clipsContent: true,
    },
  });
  const varBtnActiveId = varBtnActive.nodeId;
  const d_vba = updateNode({
    doc: varBtnActive.doc, pageId: pageId2, nodeId: varBtnActiveId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const vbaLabel = addNode({
    state, doc: d_vba, pageId: pageId2, parentId: varBtnActiveId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "label",
      x: 20, y: 12, width: 80, height: 24,
      fills: [solidPaint(WHITE)],
      opacity: 0.3,
      cornerRadius: 4,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // Test frames
  const c2_f1 = addTestFrame(ctx2, vbaLabel.doc, {
    name: "variant-resize-default", x: 50, y: 50, width: 220, height: 80, bg: WHITE,
  });
  const c2_f1_inst = addNode({
    state, doc: c2_f1.doc, pageId: pageId2, parentId: c2_f1.frameId,
    spec: {
      type: "INSTANCE", name: "VarBtnDefault-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });

  // Variant resize override — overriddenSymbolID via updateNode
  const c2_f2 = addTestFrame(ctx2, c2_f1_inst.doc, {
    name: "variant-resize-override", x: 300, y: 50, width: 220, height: 80, bg: WHITE,
  });
  const c2_f2_inst = addNode({
    state, doc: c2_f2.doc, pageId: pageId2, parentId: c2_f2.frameId,
    spec: {
      type: "INSTANCE", name: "VarBtnActive-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });
  const d_c2_f2_inst = updateNode({
    doc: c2_f2_inst.doc, pageId: pageId2, nodeId: c2_f2_inst.nodeId,
    updater: (n) => ({ ...n, overriddenSymbolID: varBtnActiveId }),
  });

  // Side by side both
  const c2_f3 = addTestFrame(ctx2, d_c2_f2_inst, {
    name: "variant-resize-both", x: 50, y: 160, width: 440, height: 80, bg: IOS_GRAY_BG,
  });
  const c2_f3_def = addNode({
    state, doc: c2_f3.doc, pageId: pageId2, parentId: c2_f3.frameId,
    spec: {
      type: "INSTANCE", name: "default-wide", symbolId: varBtnDefaultId,
      x: 10, y: 10, width: 200, height: 60,
    },
  });
  const c2_f3_active = addNode({
    state, doc: c2_f3_def.doc, pageId: pageId2, parentId: c2_f3.frameId,
    spec: {
      type: "INSTANCE", name: "active-wide", symbolId: varBtnDefaultId,
      x: 230, y: 10, width: 200, height: 60,
    },
  });
  const docAfterC2 = updateNode({
    doc: c2_f3_active.doc, pageId: pageId2, nodeId: c2_f3_active.nodeId,
    updater: (n) => ({ ...n, overriddenSymbolID: varBtnActiveId }),
  });

  // =========================================================================
  // Canvas 3: Ellipse Constraints
  // =========================================================================
  const ellipseBox = addNode({
    state, doc: docAfterC2, pageId: pageId3, parentId: null,
    spec: {
      type: "SYMBOL", name: "EllipseBox",
      x: 0, y: -600, width: 200, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const ellipseBoxId = ellipseBox.nodeId;
  const d_eb = updateNode({
    doc: ellipseBox.doc, pageId: pageId3, nodeId: ellipseBoxId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const ebCenter = addNode({
    state, doc: d_eb, pageId: pageId3, parentId: ellipseBoxId,
    spec: {
      type: "ELLIPSE", name: "center-ellipse",
      x: 70, y: 40, width: 60, height: 40,
      fills: [solidPaint(IOS_PURPLE)],
      layoutConstraints: constraintsFor("CENTER", "CENTER"),
    },
  });
  const ebStretch = addNode({
    state, doc: ebCenter.doc, pageId: pageId3, parentId: ellipseBoxId,
    spec: {
      type: "ELLIPSE", name: "stretch-ellipse",
      x: 20, y: 20, width: 160, height: 80,
      fills: [solidPaint(IOS_ORANGE)],
      opacity: 0.5,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const ellipseScaleBox = addNode({
    state, doc: ebStretch.doc, pageId: pageId3, parentId: null,
    spec: {
      type: "SYMBOL", name: "EllipseScaleBox",
      x: 300, y: -600, width: 200, height: 120,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const ellipseScaleBoxId = ellipseScaleBox.nodeId;
  const d_esb = updateNode({
    doc: ellipseScaleBox.doc, pageId: pageId3, nodeId: ellipseScaleBoxId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const esChild = addNode({
    state, doc: d_esb, pageId: pageId3, parentId: ellipseScaleBoxId,
    spec: {
      type: "ELLIPSE", name: "scaled-ellipse",
      x: 50, y: 30, width: 100, height: 60,
      fills: [solidPaint(IOS_RED)],
      layoutConstraints: constraintsFor("SCALE", "SCALE"),
    },
  });

  const c3_f1 = addTestFrame(ctx3, esChild.doc, {
    name: "ellipse-center-stretch-grow", x: 50, y: 50, width: 320, height: 200, bg: IOS_GRAY_BG,
  });
  const c3_f1_inst = addNode({
    state, doc: c3_f1.doc, pageId: pageId3, parentId: c3_f1.frameId,
    spec: {
      type: "INSTANCE", name: "EllipseBox-large", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 300, height: 180,
    },
  });
  const c3_f2 = addTestFrame(ctx3, c3_f1_inst.doc, {
    name: "ellipse-center-stretch-shrink", x: 400, y: 50, width: 180, height: 120, bg: IOS_GRAY_BG,
  });
  const c3_f2_inst = addNode({
    state, doc: c3_f2.doc, pageId: pageId3, parentId: c3_f2.frameId,
    spec: {
      type: "INSTANCE", name: "EllipseBox-small", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 160, height: 100,
    },
  });
  const c3_f3 = addTestFrame(ctx3, c3_f2_inst.doc, {
    name: "ellipse-scale", x: 50, y: 280, width: 320, height: 200, bg: WHITE,
  });
  const c3_f3_inst = addNode({
    state, doc: c3_f3.doc, pageId: pageId3, parentId: c3_f3.frameId,
    spec: {
      type: "INSTANCE", name: "EllipseScale-large", symbolId: ellipseScaleBoxId,
      x: 10, y: 10, width: 300, height: 180,
    },
  });
  const c3_f4 = addTestFrame(ctx3, c3_f3_inst.doc, {
    name: "ellipse-same-size", x: 400, y: 280, width: 220, height: 140, bg: WHITE,
  });
  const docAfterC3 = addNode({
    state, doc: c3_f4.doc, pageId: pageId3, parentId: c3_f4.frameId,
    spec: {
      type: "INSTANCE", name: "EllipseBox-same", symbolId: ellipseBoxId,
      x: 10, y: 10, width: 200, height: 120,
    },
  }).doc;

  // =========================================================================
  // Canvas 4: Asymmetric STRETCH
  // =========================================================================
  const asymBox = addNode({
    state, doc: docAfterC3, pageId: pageId4, parentId: null,
    spec: {
      type: "SYMBOL", name: "AsymBox",
      x: 0, y: -600, width: 200, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const asymBoxId = asymBox.nodeId;
  const d_ab = updateNode({
    doc: asymBox.doc, pageId: pageId4, nodeId: asymBoxId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });
  const abChild = addNode({
    state, doc: d_ab, pageId: pageId4, parentId: asymBoxId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "asym-rect",
      x: 10, y: 15, width: 140, height: 70,
      fills: [solidPaint(IOS_RED)],
      cornerRadius: 6,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const asymBoxWide = addNode({
    state, doc: abChild.doc, pageId: pageId4, parentId: null,
    spec: {
      type: "SYMBOL", name: "AsymBoxWide",
      x: 300, y: -600, width: 300, height: 100,
      fills: [solidPaint(IOS_GRAY_BG)],
      clipsContent: true,
    },
  });
  const asymBoxWideId = asymBoxWide.nodeId;
  const d_abw = updateNode({
    doc: asymBoxWide.doc, pageId: pageId4, nodeId: asymBoxWideId,
    updater: (n) => ({ ...n, cornerRadius: 8 }),
  });
  const abwChild = addNode({
    state, doc: d_abw, pageId: pageId4, parentId: asymBoxWideId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "wide-rect",
      x: 30, y: 10, width: 200, height: 50,
      fills: [solidPaint(IOS_GREEN)],
      cornerRadius: 4,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  const asymMulti = addNode({
    state, doc: abwChild.doc, pageId: pageId4, parentId: null,
    spec: {
      type: "SYMBOL", name: "AsymMultiChild",
      x: 600, y: -600, width: 240, height: 120,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const asymMultiId = asymMulti.nodeId;
  const d_am = updateNode({
    doc: asymMulti.doc, pageId: pageId4, nodeId: asymMultiId,
    updater: (n) => ({ ...n, cornerRadius: 10 }),
  });
  const amcChild1 = addNode({
    state, doc: d_am, pageId: pageId4, parentId: asymMultiId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "left-rect",
      x: 10, y: 10, width: 100, height: 40,
      fills: [solidPaint(IOS_BLUE)],
      cornerRadius: 4,
      layoutConstraints: constraintsFor("STRETCH", "MIN"),
    },
  });
  const amcChild2 = addNode({
    state, doc: amcChild1.doc, pageId: pageId4, parentId: asymMultiId,
    spec: {
      type: "ROUNDED_RECTANGLE", name: "right-rect",
      x: 130, y: 70, width: 100, height: 40,
      fills: [solidPaint(IOS_ORANGE)],
      cornerRadius: 4,
      layoutConstraints: constraintsFor("STRETCH", "MAX"),
    },
  });

  // Test frames
  const c4_f1 = addTestFrame(ctx4, amcChild2.doc, {
    name: "asym-stretch-grow", x: 50, y: 50, width: 340, height: 220, bg: IOS_GRAY_BG,
  });
  const c4_f1_inst = addNode({
    state, doc: c4_f1.doc, pageId: pageId4, parentId: c4_f1.frameId,
    spec: { type: "INSTANCE", name: "AsymBox-large", symbolId: asymBoxId, x: 10, y: 10, width: 320, height: 200 },
  });
  const c4_f2 = addTestFrame(ctx4, c4_f1_inst.doc, {
    name: "asym-stretch-shrink", x: 420, y: 50, width: 140, height: 100, bg: IOS_GRAY_BG,
  });
  const c4_f2_inst = addNode({
    state, doc: c4_f2.doc, pageId: pageId4, parentId: c4_f2.frameId,
    spec: { type: "INSTANCE", name: "AsymBox-small", symbolId: asymBoxId, x: 10, y: 10, width: 120, height: 80 },
  });
  const c4_f3 = addTestFrame(ctx4, c4_f2_inst.doc, {
    name: "asym-wide-grow", x: 50, y: 300, width: 420, height: 160, bg: WHITE,
  });
  const c4_f3_inst = addNode({
    state, doc: c4_f3.doc, pageId: pageId4, parentId: c4_f3.frameId,
    spec: { type: "INSTANCE", name: "AsymBoxWide-large", symbolId: asymBoxWideId, x: 10, y: 10, width: 400, height: 140 },
  });
  const c4_f4 = addTestFrame(ctx4, c4_f3_inst.doc, {
    name: "asym-wide-shrink", x: 500, y: 300, width: 220, height: 80, bg: WHITE,
  });
  const c4_f4_inst = addNode({
    state, doc: c4_f4.doc, pageId: pageId4, parentId: c4_f4.frameId,
    spec: { type: "INSTANCE", name: "AsymBoxWide-small", symbolId: asymBoxWideId, x: 10, y: 10, width: 200, height: 60 },
  });
  const c4_f5 = addTestFrame(ctx4, c4_f4_inst.doc, {
    name: "asym-multi-grow", x: 50, y: 490, width: 380, height: 200, bg: IOS_GRAY_BG,
  });
  const c4_f5_inst = addNode({
    state, doc: c4_f5.doc, pageId: pageId4, parentId: c4_f5.frameId,
    spec: { type: "INSTANCE", name: "AsymMulti-large", symbolId: asymMultiId, x: 10, y: 10, width: 360, height: 180 },
  });
  const c4_f6 = addTestFrame(ctx4, c4_f5_inst.doc, {
    name: "asym-multi-shrink", x: 460, y: 490, width: 200, height: 120, bg: IOS_GRAY_BG,
  });
  const c4_f6_inst = addNode({
    state, doc: c4_f6.doc, pageId: pageId4, parentId: c4_f6.frameId,
    spec: { type: "INSTANCE", name: "AsymMulti-small", symbolId: asymMultiId, x: 10, y: 10, width: 180, height: 100 },
  });
  const c4_f7 = addTestFrame(ctx4, c4_f6_inst.doc, {
    name: "asym-same-size", x: 50, y: 720, width: 220, height: 140, bg: WHITE,
  });
  const finalDoc = addNode({
    state, doc: c4_f7.doc, pageId: pageId4, parentId: c4_f7.frameId,
    spec: { type: "INSTANCE", name: "AsymBox-same", symbolId: asymBoxId, x: 10, y: 10, width: 200, height: 120 },
  }).doc;

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  for (const subdir of ["actual", "snapshots"]) {
    const dir = path.join(OUTPUT_DIR, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.byteLength / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
