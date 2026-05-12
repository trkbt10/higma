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
  createEmptyFigDesignDocument,
  exportFig,
  updateNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  AutoLayoutProps,
  FigDesignDocument,
  FigPageId,
} from "@higma-document-models/fig/domain";
import {
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
} from "@higma-document-models/fig/constants";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/components");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "components.fig");

// =============================================================================
// Helpers
// =============================================================================

function rgb(r: number, g: number, b: number): FigColor {
  return { r, g, b, a: 1 };
}

function solidPaint(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true, blendMode: "NORMAL" };
}

type StackMode = "HORIZONTAL" | "VERTICAL";
type PrimaryAlign = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";

type CounterAlign = "MIN" | "CENTER" | "MAX";

function primaryAlignValue(align: PrimaryAlign | undefined): AutoLayoutProps["stackPrimaryAlignItems"] {
  if (align === undefined) {
    return undefined;
  }
  return { value: STACK_JUSTIFY_VALUES[align], name: align };
}

function counterAlignValue(align: CounterAlign | undefined): AutoLayoutProps["stackCounterAlignItems"] {
  if (align === undefined) {
    return undefined;
  }
  return { value: STACK_ALIGN_VALUES[align], name: align };
}

// Build an AutoLayoutProps payload. `primaryAlign` uses StackJustify
// (`MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN`) and `counterAlign` uses
// PrimaryAlign (`MIN`/`CENTER`/`MAX`).
function autoLayout(opts: {
  readonly mode: StackMode;
  readonly gap?: number;
  readonly padding?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly primaryAlign?: PrimaryAlign;
  readonly counterAlign?: CounterAlign;
}): AutoLayoutProps {
  return {
    stackMode: { value: STACK_MODE_VALUES[opts.mode], name: opts.mode },
    stackSpacing: opts.gap,
    stackPadding: opts.padding,
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
  readonly pageId: FigPageId;
};

async function generateComponentFixtures(): Promise<void> {
  console.log("Generating component fixtures...");

  const empty = createEmptyFigDesignDocument("Components");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  // The single CANVAS embedded in `createEmptyFigDesignDocument` is the
  // Components canvas. Add the Internal Only Canvas after — Figma's
  // importer expects exactly one (see CLAUDE.md).
  const doc0 = addPage({
    state, doc: empty, name: "Internal Only Canvas", internalOnly: true,
  }).doc;
  const ctx: Ctx = { state, pageId };

  // ==========================================================================
  // Symbol 1: Basic Button Component
  // ==========================================================================
  const buttonSymbol = addNode({
    state: ctx.state,
    doc: doc0,
    pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "Button",
      x: 50,
      y: 50,
      width: 120,
      height: 40,
      fills: [solidPaint(rgb(0.2, 0.5, 0.9))],
      clipsContent: true,
      autoLayout: autoLayout({
        mode: "HORIZONTAL",
        gap: 8,
        padding: { top: 8, right: 16, bottom: 8, left: 16 },
        primaryAlign: "CENTER",
        counterAlign: "CENTER",
      }),
    },
  });
  const buttonSymbolId = buttonSymbol.nodeId;

  // Button background rect
  const buttonBg = addNode({
    state: ctx.state, doc: buttonSymbol.doc, pageId: ctx.pageId,
    parentId: buttonSymbolId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "bg",
      x: 0, y: 0, width: 120, height: 40,
      fills: [solidPaint(rgb(0.2, 0.5, 0.9))],
      cornerRadius: 8,
    },
  });

  // Button text
  const buttonText = addNode({
    state: ctx.state, doc: buttonBg.doc, pageId: ctx.pageId,
    parentId: buttonSymbolId,
    spec: {
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
    state: ctx.state, doc: buttonText.doc, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-single",
      x: 50, y: 150, width: 160, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      clipsContent: true,
    },
  });
  const instance1 = addNode({
    state: ctx.state, doc: frame1.doc, pageId: ctx.pageId,
    parentId: frame1.nodeId,
    spec: {
      type: "INSTANCE", name: "Button Instance", symbolId: buttonSymbolId,
      x: 20, y: 20, width: 120, height: 40,
    },
  });

  // ==========================================================================
  // Frame 2: Multiple Instances
  // ==========================================================================
  const frame2 = addNode({
    state: ctx.state, doc: instance1.doc, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-multi",
      x: 50, y: 250, width: 160, height: 160,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      autoLayout: autoLayout({ mode: "VERTICAL", gap: 10, padding: uniformPadding(20) }),
      clipsContent: true,
    },
  });

  const frame2Filled = [0, 1, 2].reduce<FigDesignDocument>((acc, i) => {
    const r = addNode({
      state: ctx.state, doc: acc, pageId: ctx.pageId,
      parentId: frame2.nodeId,
      spec: {
        type: "INSTANCE", name: `Button ${i + 1}`, symbolId: buttonSymbolId,
        x: 20, y: 20 + i * 50, width: 120, height: 40,
      },
    });
    return r.doc;
  }, frame2.doc);

  // ==========================================================================
  // Frame 3: Instance with Override
  // ==========================================================================
  const frame3 = addNode({
    state: ctx.state, doc: frame2Filled, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-override-fill",
      x: 50, y: 430, width: 300, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      autoLayout: autoLayout({ mode: "HORIZONTAL", gap: 20, padding: uniformPadding(20) }),
      clipsContent: true,
    },
  });

  // Original color instance
  const f3Inst1 = addNode({
    state: ctx.state, doc: frame3.doc, pageId: ctx.pageId,
    parentId: frame3.nodeId,
    spec: {
      type: "INSTANCE", name: "Original", symbolId: buttonSymbolId,
      x: 20, y: 20, width: 120, height: 40,
    },
  });
  // Red override instance — the override translates to a fills array on
  // the INSTANCE itself, which Figma applies on top of the SYMBOL's own
  // fills when resolving the instance.
  const f3Inst2 = addNode({
    state: ctx.state, doc: f3Inst1.doc, pageId: ctx.pageId,
    parentId: frame3.nodeId,
    spec: {
      type: "INSTANCE", name: "Red Override", symbolId: buttonSymbolId,
      x: 160, y: 20, width: 120, height: 40,
      fills: [solidPaint(rgb(0.9, 0.2, 0.2))],
    },
  });

  // ==========================================================================
  // Symbol 2: Card Component (for nesting)
  // ==========================================================================
  const cardSymbol = addNode({
    state: ctx.state, doc: f3Inst2.doc, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "Card",
      x: 250, y: 50, width: 180, height: 100,
      fills: [solidPaint(rgb(1, 1, 1))],
      clipsContent: true,
      autoLayout: autoLayout({ mode: "VERTICAL", gap: 8, padding: uniformPadding(16) }),
    },
  });
  const cardSymbolId = cardSymbol.nodeId;
  // RoundedRect specs are reserved for actual rounded rects on disk;
  // FRAME/SYMBOL use a separate `cornerRadius` field at FigDesignNode
  // level rather than a RoundedRect-style spec. Set it via updateNode.
  const cardSymbolRounded = updateNode({
    doc: cardSymbol.doc, pageId: ctx.pageId, nodeId: cardSymbolId,
    updater: (n) => ({ ...n, cornerRadius: 12 }),
  });

  // Card title
  const cardTitle = addNode({
    state: ctx.state, doc: cardSymbolRounded, pageId: ctx.pageId,
    parentId: cardSymbolId,
    spec: {
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
    state: ctx.state, doc: cardTitle.doc, pageId: ctx.pageId,
    parentId: cardSymbolId,
    spec: {
      type: "INSTANCE", name: "action", symbolId: buttonSymbolId,
      x: 16, y: 44, width: 120, height: 40,
    },
  });

  // ==========================================================================
  // Frame 4: Nested Components
  // ==========================================================================
  const frame4 = addNode({
    state: ctx.state, doc: nestedButton.doc, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-nested",
      x: 250, y: 150, width: 220, height: 140,
      fills: [solidPaint(rgb(0.9, 0.9, 0.95))],
      clipsContent: true,
    },
  });
  const cardInst = addNode({
    state: ctx.state, doc: frame4.doc, pageId: ctx.pageId,
    parentId: frame4.nodeId,
    spec: {
      type: "INSTANCE", name: "Card Instance", symbolId: cardSymbolId,
      x: 20, y: 20, width: 180, height: 100,
    },
  });

  // ==========================================================================
  // Frame 5: Instances in Auto-Layout
  // ==========================================================================
  const frame5 = addNode({
    state: ctx.state, doc: cardInst.doc, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-in-autolayout",
      x: 250, y: 310, width: 400, height: 80,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      autoLayout: autoLayout({
        mode: "HORIZONTAL", gap: 16, padding: uniformPadding(20),
        primaryAlign: "SPACE_BETWEEN", counterAlign: "CENTER",
      }),
      clipsContent: true,
    },
  });

  const frame5Filled = [0, 1, 2].reduce<FigDesignDocument>((acc, i) => {
    const r = addNode({
      state: ctx.state, doc: acc, pageId: ctx.pageId,
      parentId: frame5.nodeId,
      spec: {
        type: "INSTANCE", name: `Action ${i + 1}`, symbolId: buttonSymbolId,
        x: 20 + i * 130, y: 20, width: 100, height: 40,
        layoutConstraints: { stackChildPrimaryGrow: 1 },
      },
    });
    return r.doc;
  }, frame5.doc);

  // ==========================================================================
  // Symbol 3: Simple Icon Component
  // ==========================================================================
  const iconSymbol = addNode({
    state: ctx.state, doc: frame5Filled, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "Icon",
      x: 500, y: 50, width: 24, height: 24,
      fills: [solidPaint(rgb(0.5, 0.5, 0.5))],
      clipsContent: true,
    },
  });
  const iconSymbolId = iconSymbol.nodeId;
  const iconSymbolRounded = updateNode({
    doc: iconSymbol.doc, pageId: ctx.pageId, nodeId: iconSymbolId,
    updater: (n) => ({ ...n, cornerRadius: 4 }),
  });

  // ==========================================================================
  // Frame 6: Multiple Icon Instances
  // ==========================================================================
  const frame6 = addNode({
    state: ctx.state, doc: iconSymbolRounded, pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "instance-icons",
      x: 250, y: 410, width: 200, height: 60,
      fills: [solidPaint(rgb(0.95, 0.95, 0.95))],
      autoLayout: autoLayout({
        mode: "HORIZONTAL", gap: 8, padding: uniformPadding(18),
        primaryAlign: "MIN", counterAlign: "CENTER",
      }),
      clipsContent: true,
    },
  });

  const finalDoc = [0, 1, 2, 3, 4].reduce<FigDesignDocument>((acc, i) => {
    const r = addNode({
      state: ctx.state, doc: acc, pageId: ctx.pageId,
      parentId: frame6.nodeId,
      spec: {
        type: "INSTANCE", name: `icon-${i + 1}`, symbolId: iconSymbolId,
        x: 18 + i * 32, y: 18, width: 24, height: 24,
      },
    });
    return r.doc;
  }, frame6.doc);

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
  const exported = await exportFig(finalDoc);
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
