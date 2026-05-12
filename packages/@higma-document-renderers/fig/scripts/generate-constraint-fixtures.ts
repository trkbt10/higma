#!/usr/bin/env bun
/**
 * @file Generate comprehensive constraint test fixture .fig file
 *
 * Canvas 1 — "Single Constraints":
 *   25 frames testing all H×V constraint combinations (5×5 grid).
 *   SYMBOL (100×60) with child rect at (10,10) size(60×30).
 *   INSTANCE resized to 160×100.
 *
 * Canvas 2 — "Nested Instance":
 *   Nested INSTANCE cases — circle-to-pill, rounded rect resize.
 *   Tests expandContainersToFitChildren INSTANCE skip + multi-level dsd.
 *
 * Canvas 3 — "Multi-child":
 *   SYMBOL with 3 children having different constraints.
 *   Verifies each child is independently resolved.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-constraint-fixtures.ts
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
  LayoutConstraints,
} from "@higma-document-models/fig/domain";
import { CONSTRAINT_TYPE_VALUES, type ConstraintType } from "@higma-document-models/fig/constants";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/constraints");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "constraints.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const BLUE: FigColor = { r: 0, g: 0.478, b: 1, a: 1 };
const GREEN: FigColor = { r: 0.204, g: 0.78, b: 0.349, a: 1 };
const RED: FigColor = { r: 1, g: 0.231, b: 0.188, a: 1 };
const ORANGE: FigColor = { r: 1, g: 0.584, b: 0, a: 1 };

const CONSTRAINTS: readonly ConstraintType[] = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];

const SYM_W = 100;
const SYM_H = 60;
const CHILD_X = 10;
const CHILD_Y = 10;
const CHILD_W = 60;
const CHILD_H = 30;
const INST_W = 160;
const INST_H = 100;

function solidPaint(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true, blendMode: "NORMAL" };
}

function constraintsFor(h: ConstraintType, v: ConstraintType): LayoutConstraints {
  return {
    horizontalConstraint: { value: CONSTRAINT_TYPE_VALUES[h], name: h },
    verticalConstraint: { value: CONSTRAINT_TYPE_VALUES[v], name: v },
  };
}

async function generate(): Promise<void> {
  console.log("Generating constraint fixtures...\n");
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const empty = createEmptyFigDesignDocument("Single Constraints");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId1 = empty.pages[0]!.id;
  const r1 = addPage({ state, doc: empty, name: "Nested Instance" });
  const pageId2 = r1.pageId;
  const r2 = addPage({ state, doc: r1.doc, name: "Multi-child" });
  const pageId3 = r2.pageId;
  const r3 = addPage({ state, doc: r2.doc, name: "Internal Only Canvas", internalOnly: true });

  // =========================================================================
  // Canvas 1: Single Constraints (25 frames, 5×5 grid)
  // =========================================================================
  const frameW = INST_W + 20;
  const frameH = INST_H + 20;
  const gap = 20;

  const cells: readonly { readonly hi: number; readonly vi: number }[] = CONSTRAINTS.flatMap(
    (_, hi) => CONSTRAINTS.map((__, vi) => ({ hi, vi })),
  );

  const afterCanvas1 = cells.reduce<FigDesignDocument>((acc, { hi, vi }) => {
    const h = CONSTRAINTS[hi];
    const v = CONSTRAINTS[vi];

    const sym = addNode({
      state, doc: acc, pageId: pageId1, parentId: null,
      spec: {
        type: "SYMBOL",
        name: `Sym-${h}-${v}`,
        x: 0, y: -500 - (hi * 5 + vi) * 100,
        width: SYM_W, height: SYM_H,
        clipsContent: true,
      },
    });
    const child = addNode({
      state, doc: sym.doc, pageId: pageId1, parentId: sym.nodeId,
      spec: {
        type: "ROUNDED_RECTANGLE",
        name: "child",
        x: CHILD_X, y: CHILD_Y, width: CHILD_W, height: CHILD_H,
        fills: [solidPaint(BLUE)],
        cornerRadius: 4,
        layoutConstraints: constraintsFor(h, v),
      },
    });
    const frame = addNode({
      state, doc: child.doc, pageId: pageId1, parentId: null,
      spec: {
        type: "FRAME",
        name: `${h}-${v}`,
        x: vi * (frameW + gap), y: hi * (frameH + gap),
        width: frameW, height: frameH,
        fills: [solidPaint(WHITE)],
      },
    });
    const inst = addNode({
      state, doc: frame.doc, pageId: pageId1, parentId: frame.nodeId,
      spec: {
        type: "INSTANCE",
        name: `inst-${h}-${v}`,
        symbolId: sym.nodeId,
        x: 10, y: 10, width: INST_W, height: INST_H,
      },
    });
    return inst.doc;
  }, r3.doc);

  // =========================================================================
  // Canvas 2: Nested Instance
  // =========================================================================

  // --- CircleBG SYMBOL (48x48, cr=1000 → circle) ---
  const circleBg = addNode({
    state, doc: afterCanvas1, pageId: pageId2, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "CircleBG",
      x: 0, y: -200, width: 48, height: 48,
      fills: [solidPaint(BLUE)],
      clipsContent: true,
    },
  });
  const circleBgId = circleBg.nodeId;
  // SYMBOL specs don't carry cornerRadius — we set it via updateNode.
  const docCBG1 = updateNode({
    doc: circleBg.doc, pageId: pageId2, nodeId: circleBgId,
    updater: (n) => ({ ...n, cornerRadius: 1000 }),
  });
  const circleBgInner = addNode({
    state, doc: docCBG1, pageId: pageId2, parentId: circleBgId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "inner-fill",
      x: 0, y: 0, width: 48, height: 48,
      fills: [solidPaint(BLUE)],
      cornerRadius: 1000,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // --- WindowControl SYMBOL (44x22, uses CircleBG) ---
  const windowControl = addNode({
    state, doc: circleBgInner.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "WindowControl",
      x: 0, y: -100, width: 44, height: 22,
      clipsContent: true,
    },
  });
  const windowControlId = windowControl.nodeId;
  const wcInstBg = addNode({
    state, doc: windowControl.doc, pageId: pageId2, parentId: windowControlId,
    spec: {
      type: "INSTANCE",
      name: "BG",
      symbolId: circleBgId,
      x: 0, y: 0, width: 44, height: 22,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });
  const wcDot1 = addNode({
    state, doc: wcInstBg.doc, pageId: pageId2, parentId: windowControlId,
    spec: {
      type: "ELLIPSE",
      name: "dot1",
      x: 10, y: 8, width: 6, height: 6,
      fills: [solidPaint(RED)],
    },
  });
  const wcDot2 = addNode({
    state, doc: wcDot1.doc, pageId: pageId2, parentId: windowControlId,
    spec: {
      type: "ELLIPSE",
      name: "dot2",
      x: 19, y: 8, width: 6, height: 6,
      fills: [solidPaint(ORANGE)],
    },
  });
  const wcDot3 = addNode({
    state, doc: wcDot2.doc, pageId: pageId2, parentId: windowControlId,
    spec: {
      type: "ELLIPSE",
      name: "dot3",
      x: 28, y: 8, width: 6, height: 6,
      fills: [solidPaint(GREEN)],
    },
  });

  // --- Test Frame: circle-to-pill (44x22) ---
  const fPill = addNode({
    state, doc: wcDot3.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "FRAME",
      name: "circle-to-pill",
      x: 50, y: 50, width: 80, height: 50,
      fills: [solidPaint(WHITE)],
    },
  });
  const fPillInst = addNode({
    state, doc: fPill.doc, pageId: pageId2, parentId: fPill.nodeId,
    spec: {
      type: "INSTANCE",
      name: "control-pill",
      symbolId: windowControlId,
      x: 18, y: 14, width: 44, height: 22,
    },
  });

  // --- Test Frame: circle-to-wide-pill (80x22) ---
  const fWidePill = addNode({
    state, doc: fPillInst.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "FRAME",
      name: "circle-to-wide-pill",
      x: 50, y: 120, width: 120, height: 50,
      fills: [solidPaint(WHITE)],
    },
  });
  const fWidePillInst = addNode({
    state, doc: fWidePill.doc, pageId: pageId2, parentId: fWidePill.nodeId,
    spec: {
      type: "INSTANCE",
      name: "control-wide",
      symbolId: windowControlId,
      x: 20, y: 14, width: 80, height: 22,
    },
  });

  // --- RoundedBox SYMBOL (40x40, cr=10) ---
  const roundedBox = addNode({
    state, doc: fWidePillInst.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "RoundedBox",
      x: 0, y: -300, width: 40, height: 40,
      fills: [solidPaint(GREEN)],
      clipsContent: true,
    },
  });
  const roundedBoxId = roundedBox.nodeId;
  const rbWithRadius = updateNode({
    doc: roundedBox.doc, pageId: pageId2, nodeId: roundedBoxId,
    updater: (n) => ({ ...n, cornerRadius: 10 }),
  });
  const rbFill = addNode({
    state, doc: rbWithRadius, pageId: pageId2, parentId: roundedBoxId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bg-fill",
      x: 0, y: 0, width: 40, height: 40,
      fills: [solidPaint(GREEN)],
      cornerRadius: 10,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });

  // --- Test Frame: rounded-grow-h ---
  const fGrowH = addNode({
    state, doc: rbFill.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "FRAME",
      name: "rounded-grow-h",
      x: 50, y: 200, width: 140, height: 80,
      fills: [solidPaint(WHITE)],
    },
  });
  const fGrowHInst = addNode({
    state, doc: fGrowH.doc, pageId: pageId2, parentId: fGrowH.nodeId,
    spec: {
      type: "INSTANCE", name: "box-wide", symbolId: roundedBoxId,
      x: 20, y: 20, width: 100, height: 40,
    },
  });

  // --- Test Frame: rounded-grow-both ---
  const fGrowBoth = addNode({
    state, doc: fGrowHInst.doc, pageId: pageId2, parentId: null,
    spec: {
      type: "FRAME",
      name: "rounded-grow-both",
      x: 50, y: 300, width: 140, height: 100,
      fills: [solidPaint(WHITE)],
    },
  });
  const fGrowBothInst = addNode({
    state, doc: fGrowBoth.doc, pageId: pageId2, parentId: fGrowBoth.nodeId,
    spec: {
      type: "INSTANCE", name: "box-larger", symbolId: roundedBoxId,
      x: 20, y: 20, width: 100, height: 60,
    },
  });

  // =========================================================================
  // Canvas 3: Multi-child
  // =========================================================================
  const multiSym = addNode({
    state, doc: fGrowBothInst.doc, pageId: pageId3, parentId: null,
    spec: {
      type: "SYMBOL",
      name: "MultiChild",
      x: 0, y: -200, width: 200, height: 100,
      clipsContent: true,
    },
  });
  const multiSymId = multiSym.nodeId;
  // Child 1: STRETCH × STRETCH (background fill)
  const multiC1 = addNode({
    state, doc: multiSym.doc, pageId: pageId3, parentId: multiSymId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bg",
      x: 0, y: 0, width: 200, height: 100,
      fills: [solidPaint({ r: 0.9, g: 0.9, b: 0.95, a: 1 })],
      cornerRadius: 0,
      layoutConstraints: constraintsFor("STRETCH", "STRETCH"),
    },
  });
  // Child 2: CENTER × CENTER
  const multiC2 = addNode({
    state, doc: multiC1.doc, pageId: pageId3, parentId: multiSymId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "center-box",
      x: 70, y: 35, width: 60, height: 30,
      fills: [solidPaint(BLUE)],
      cornerRadius: 8,
      layoutConstraints: constraintsFor("CENTER", "CENTER"),
    },
  });
  // Child 3: MAX × MAX
  const multiC3 = addNode({
    state, doc: multiC2.doc, pageId: pageId3, parentId: multiSymId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "corner-badge",
      x: 170, y: 70, width: 20, height: 20,
      fills: [solidPaint(RED)],
      cornerRadius: 10,
      layoutConstraints: constraintsFor("MAX", "MAX"),
    },
  });
  // Test frame
  const multiF = addNode({
    state, doc: multiC3.doc, pageId: pageId3, parentId: null,
    spec: {
      type: "FRAME",
      name: "multi-child-grow",
      x: 50, y: 50, width: 320, height: 180,
      fills: [solidPaint(WHITE)],
    },
  });
  const finalDoc = addNode({
    state, doc: multiF.doc, pageId: pageId3, parentId: multiF.nodeId,
    spec: {
      type: "INSTANCE",
      name: "multi-inst",
      symbolId: multiSymId,
      x: 10, y: 10, width: 300, height: 160,
    },
  }).doc;

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Written: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.byteLength / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
