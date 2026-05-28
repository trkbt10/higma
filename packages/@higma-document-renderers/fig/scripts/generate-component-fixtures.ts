#!/usr/bin/env bun
/**
 * @file Generate component fixture .fig file
 *
 * Creates a .fig file with component (SYMBOL/INSTANCE) examples for testing:
 * - Basic symbol with children
 * - Single instance
 * - Multiple instances
 * - Instance with fill override
 * - Nested components
 * - Instances in auto-layout
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-component-fixtures.ts
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
  type KiwiStackLayoutFields,
  type SolidPaintSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import {
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
} from "@higma-document-models/fig/constants";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/components");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "components.fig");

// =============================================================================
// Shared construction
// =============================================================================

function rgb(r: number, g: number, b: number): FigColor {
  return { r, g, b, a: 1 };
}

function solidPaint(color: FigColor): SolidPaintSpec {
  return { type: "SOLID", color, opacity: 1, visible: true };
}

type StackMode = "HORIZONTAL" | "VERTICAL";
type PrimaryAlign = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";

type CounterAlign = "MIN" | "CENTER" | "MAX";

function primaryAlignValue(align: PrimaryAlign | undefined): KiwiStackLayoutFields["stackPrimaryAlignItems"] {
  if (align === undefined) {
    return undefined;
  }
  return { value: STACK_JUSTIFY_VALUES[align], name: align };
}

function counterAlignValue(align: CounterAlign | undefined): KiwiStackLayoutFields["stackCounterAlignItems"] {
  if (align === undefined) {
    return undefined;
  }
  return { value: STACK_ALIGN_VALUES[align], name: align };
}

// Build an KiwiStackLayoutFields payload. `primaryAlign` uses StackJustify
// (`MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN`) and `counterAlign` uses
// PrimaryAlign (`MIN`/`CENTER`/`MAX`).
function autoLayout(opts: {
  readonly mode: StackMode;
  readonly gap?: number;
  readonly padding?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly primaryAlign?: PrimaryAlign;
  readonly counterAlign?: CounterAlign;
}): KiwiStackLayoutFields {
  return {
    stackMode: { value: STACK_MODE_VALUES[opts.mode], name: opts.mode },
    stackSpacing: opts.gap,
    stackVerticalPadding: opts.padding?.top,
    stackHorizontalPadding: opts.padding?.left,
    stackPaddingRight: opts.padding?.right,
    stackPaddingBottom: opts.padding?.bottom,
    stackPrimaryAlignItems: primaryAlignValue(opts.primaryAlign),
    stackCounterAlignItems: counterAlignValue(opts.counterAlign),
  };
}

function uniformPadding(p: number): { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } {
  return { top: p, right: p, bottom: p, left: p };
}

// =============================================================================
// Generate
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageGuid: FigGuid;
};

async function generateComponentFixtures(): Promise<void> {
  console.log("Generating component fixtures...");

  const empty = createEmptyFigDocument("Components");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Components").guid;
  // The single CANVAS embedded in `createEmptyFigDocument` is the
  // Components canvas. Add the Internal Only Canvas after — Figma's
  // importer expects exactly one (see CLAUDE.md).
  const doc0 = addPage({
    state, context: empty, name: "Internal Only Canvas", internalOnly: true,
  }).context;
  const ctx: Ctx = { state, pageGuid };

  // ==========================================================================
  // Symbol 1: Basic Button Component
  // ==========================================================================
  const buttonSymbol = addNode({
    state: ctx.state,
    context: doc0,
    pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: "Button",
      x: 50,
      y: 50,
      width: 120,
      height: 40,
      fills: [solidPaint(rgb(0.2, 0.5, 0.9))],
      clipsContent: true,
      ...autoLayout({
        mode: "HORIZONTAL",
        gap: 8,
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
        primaryAlign: "CENTER",
        counterAlign: "CENTER",
      }),
    },
  });
  const buttonSymbolId = buttonSymbol.nodeGuid;

  // Button background rect
  const buttonBg = addNode({
    state: ctx.state, context: buttonSymbol.context, pageGuid: ctx.pageGuid,
    parentGuid: buttonSymbolId,
    spec: {
      visible: true,
      opacity: 1,
      type: "ROUNDED_RECTANGLE",
      name: "bg",
      x: 0, y: 0, width: 120, height: 40,
      fills: [solidPaint(rgb(0.2, 0.5, 0.9))],
      cornerRadius: 8,
    },
  });

  // Button text
  const buttonText = addNode({
    state: ctx.state, context: buttonBg.context, pageGuid: ctx.pageGuid,
    parentGuid: buttonSymbolId,
    spec: {
      visible: true,
      opacity: 1,
      type: "TEXT",
      name: "label",
      characters: "Click Me",
      fontFamily: "Inter",
      fontStyle: "Medium",
      fontSize: 14,
      fills: [solidPaint(rgb(1, 1, 1))],
      x: 30, y: 10, width: 60, height: 20,
    },
  });

  // ==========================================================================
  // Frame 1: Single Instance
  // ==========================================================================
  const frame1 = addNode({
    state: ctx.state, context: buttonText.context, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-single",
      x: 50, y: 150, width: 160, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      clipsContent: true,
    },
  });
  const instance1 = addNode({
    state: ctx.state, context: frame1.context, pageGuid: ctx.pageGuid,
    parentGuid: frame1.nodeGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "Button Instance", symbolId: buttonSymbolId,
      x: 20, y: 20, width: 120, height: 40,
    },
  });

  // ==========================================================================
  // Frame 2: Multiple Instances
  // ==========================================================================
  const frame2 = addNode({
    state: ctx.state, context: instance1.context, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-multi",
      x: 50, y: 250, width: 160, height: 160,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      ...autoLayout({ mode: "VERTICAL", gap: 10, padding: uniformPadding(20) }),
      clipsContent: true,
    },
  });

  const frame2Filled = [0, 1, 2].reduce<FigDocumentContext>((acc, i) => {
    const r = addNode({
      state: ctx.state, context: acc, pageGuid: ctx.pageGuid,
      parentGuid: frame2.nodeGuid,
      spec: {
        visible: true,
        opacity: 1,
        type: "INSTANCE", name: `Button ${i + 1}`, symbolId: buttonSymbolId,
        x: 20, y: 20 + i * 50, width: 120, height: 40,
      },
    });
    return r.context;
  }, frame2.context);

  // ==========================================================================
  // Frame 3: Instance with Override
  // ==========================================================================
  const frame3 = addNode({
    state: ctx.state, context: frame2Filled, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-override-fill",
      x: 50, y: 430, width: 300, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      ...autoLayout({ mode: "HORIZONTAL", gap: 20, padding: uniformPadding(20) }),
      clipsContent: true,
    },
  });

  // Original color instance
  const f3Inst1 = addNode({
    state: ctx.state, context: frame3.context, pageGuid: ctx.pageGuid,
    parentGuid: frame3.nodeGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "Original", symbolId: buttonSymbolId,
      x: 20, y: 20, width: 120, height: 40,
    },
  });
  // Red override instance — the override translates to a fills array on
  // the INSTANCE itself, which Figma applies on top of the SYMBOL's own
  // fills when resolving the instance.
  const f3Inst2 = addNode({
    state: ctx.state, context: f3Inst1.context, pageGuid: ctx.pageGuid,
    parentGuid: frame3.nodeGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "Red Override", symbolId: buttonSymbolId,
      x: 160, y: 20, width: 120, height: 40,
      fills: [solidPaint(rgb(0.9, 0.2, 0.2))],
    },
  });

  // ==========================================================================
  // Symbol 2: Card Component (for nesting)
  // ==========================================================================
  const cardSymbol = addNode({
    state: ctx.state, context: f3Inst2.context, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: "Card",
      x: 250, y: 50, width: 180, height: 100,
      fills: [solidPaint(rgb(1, 1, 1))],
      clipsContent: true,
      ...autoLayout({ mode: "VERTICAL", gap: 8, padding: uniformPadding(16) }),
    },
  });
  const cardSymbolId = cardSymbol.nodeGuid;
  // RoundedRect specs are reserved for actual rounded rects on disk;
  // FRAME/SYMBOL carry `cornerRadius` directly on the Kiwi node.
  const cardSymbolRounded = updateNode({
    context: cardSymbol.context, nodeGuid: cardSymbolId,
    update: (n) => ({ ...n, cornerRadius: 12 }),
  });

  // Card title
  const cardTitle = addNode({
    state: ctx.state, context: cardSymbolRounded, pageGuid: ctx.pageGuid,
    parentGuid: cardSymbolId,
    spec: {
      visible: true,
      opacity: 1,
      type: "TEXT",
      name: "title",
      characters: "Card Title",
      fontFamily: "Inter",
      fontStyle: "Bold",
      fontSize: 16,
      fills: [solidPaint(rgb(0.1, 0.1, 0.1))],
      x: 16, y: 16, width: 148, height: 20,
    },
  });

  // Nested button instance inside card symbol
  const nestedButton = addNode({
    state: ctx.state, context: cardTitle.context, pageGuid: ctx.pageGuid,
    parentGuid: cardSymbolId,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "action", symbolId: buttonSymbolId,
      x: 16, y: 44, width: 120, height: 40,
    },
  });

  // ==========================================================================
  // Frame 4: Nested Components
  // ==========================================================================
  const frame4 = addNode({
    state: ctx.state, context: nestedButton.context, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-nested",
      x: 250, y: 150, width: 220, height: 140,
      fills: [solidPaint(rgb(0.9, 0.9, 0.95))],
      clipsContent: true,
    },
  });
  const cardInst = addNode({
    state: ctx.state, context: frame4.context, pageGuid: ctx.pageGuid,
    parentGuid: frame4.nodeGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "INSTANCE", name: "Card Instance", symbolId: cardSymbolId,
      x: 20, y: 20, width: 180, height: 100,
    },
  });

  // ==========================================================================
  // Frame 5: Instances in Auto-Layout
  // ==========================================================================
  const frame5 = addNode({
    state: ctx.state, context: cardInst.context, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-in-autolayout",
      x: 250, y: 310, width: 400, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      ...autoLayout({
        mode: "HORIZONTAL", gap: 16, padding: uniformPadding(20),
        primaryAlign: "SPACE_BETWEEN", counterAlign: "CENTER",
      }),
      clipsContent: true,
    },
  });

  const frame5Filled = [0, 1, 2].reduce<FigDocumentContext>((acc, i) => {
    const r = addNode({
      state: ctx.state, context: acc, pageGuid: ctx.pageGuid,
      parentGuid: frame5.nodeGuid,
      spec: {
        visible: true,
        opacity: 1,
        type: "INSTANCE", name: `Action ${i + 1}`, symbolId: buttonSymbolId,
        x: 20 + i * 130, y: 20, width: 100, height: 40,
        ...{ stackChildPrimaryGrow: 1 },
      },
    });
    return r.context;
  }, frame5.context);

  // ==========================================================================
  // Symbol 3: Simple Icon Component
  // ==========================================================================
  const iconSymbol = addNode({
    state: ctx.state, context: frame5Filled, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "SYMBOL",
      name: "Icon",
      x: 500, y: 50, width: 24, height: 24,
      fills: [solidPaint(rgb(0.5, 0.5, 0.5))],
      clipsContent: true,
    },
  });
  const iconSymbolId = iconSymbol.nodeGuid;
  const iconSymbolRounded = updateNode({
    context: iconSymbol.context, nodeGuid: iconSymbolId,
    update: (n) => ({ ...n, cornerRadius: 4 }),
  });

  // ==========================================================================
  // Frame 6: Multiple Icon Instances
  // ==========================================================================
  const frame6 = addNode({
    state: ctx.state, context: iconSymbolRounded, pageGuid: ctx.pageGuid,
    parentGuid: null,
    spec: {
      visible: true,
      opacity: 1,
      type: "FRAME",
      name: "instance-icons",
      x: 250, y: 410, width: 200, height: 60,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      ...autoLayout({
        mode: "HORIZONTAL", gap: 8, padding: uniformPadding(18),
        primaryAlign: "MIN", counterAlign: "CENTER",
      }),
      clipsContent: true,
    },
  });

  const finalContext = [0, 1, 2, 3, 4].reduce<FigDocumentContext>((acc, i) => {
    const r = addNode({
      state: ctx.state, context: acc, pageGuid: ctx.pageGuid,
      parentGuid: frame6.nodeGuid,
      spec: {
        visible: true,
        opacity: 1,
        type: "INSTANCE", name: `icon-${i + 1}`, symbolId: iconSymbolId,
        x: 18 + i * 32, y: 18, width: 24, height: 24,
      },
    });
    return r.context;
  }, frame6.context);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Create actual/ directory for SVG exports
  const actualDir = path.join(OUTPUT_DIR, "actual");
  if (!fs.existsSync(actualDir)) {
    fs.mkdirSync(actualDir, { recursive: true });
  }

  // Build and write the .fig file
  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`\nSymbols:`);
  console.log(`  - Button (120x40)`);
  console.log(`  - Card (180x100) - contains nested Button`);
  console.log(`  - Icon (24x24)`);
  console.log(`\nTest Frames:`);
  console.log(`  - instance-single: Single button instance`);
  console.log(`  - instance-multi: Multiple button instances in vertical layout`);
  console.log(`  - instance-override-fill: Instances with fill overrides`);
  console.log(`  - instance-nested: Card with nested button (2-level nesting)`);
  console.log(`  - instance-in-autolayout: Buttons in horizontal auto-layout`);
  console.log(`  - instance-icons: Multiple small icon instances`);

  console.log(`\nNext steps:`);
  console.log(`1. Open ${OUTPUT_FILE} in Figma`);
  console.log(`2. Adjust positions if needed`);
  console.log(`3. Export each frame as SVG to ${actualDir}/`);
  console.log(`4. Run: npx vitest run packages/@higma-document-renderers/fig/spec/components.spec.ts`);
}

// Run
generateComponentFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
