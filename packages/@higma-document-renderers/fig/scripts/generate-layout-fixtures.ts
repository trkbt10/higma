#!/usr/bin/env bun
/**
 * @file Generate fixtures/layouts/layouts.fig
 *
 * The `layouts.spec.ts` integration test reads layer names from this
 * file and exercises the SVG renderer against the matching
 * Figma-exported SVGs under `fixtures/layouts/actual/`. The set of
 * layer names is therefore a load-bearing contract — adding,
 * removing, or renaming an entry here without updating the spec /
 * actual SVGs will silently skip cases.
 *
 * Positions in each test case are pre-computed to match Figma's
 * AutoLayout solver output: the renderer does not (yet) re-run the
 * AutoLayout pass, so each child sits at the absolute coordinate
 * Figma would have produced. The `stackMode` / `stackSpacing` /
 * `stackPrimaryAlignItems` / `stackCounterAlignItems` properties are
 * preserved on the parent frame as metadata so the
 * "Layout-specific properties" describe block can still observe them.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-layout-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  AutoLayoutProps,
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";
import {
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  type StackAlign,
  type StackJustify,
} from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/layouts");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "layouts.fig");

// =============================================================================
// Color helpers
// =============================================================================

/**
 * Parse a `#rrggbb` hex string into the normalised `FigColor` shape.
 * The legacy script encoded each test case's palette as hex literals
 * because the source data was hand-tuned against the Figma UI; we
 * preserve those exact values rather than re-encoding to the
 * autolayout fixture's slightly different palette, so the rendered
 * snapshots stay byte-identical across the migration.
 */
function hexColor(hex: string, alpha: number = 1): FigColor {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b, a: alpha };
}

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

// =============================================================================
// Test case data
// =============================================================================

type StackMode = "HORIZONTAL" | "VERTICAL";
type CounterAlign = Extract<StackAlign, "MIN" | "CENTER" | "MAX">;

type ChildData = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly cornerRadius?: number;
};

type FrameData = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly stackMode?: StackMode;
  readonly stackSpacing?: number;
  readonly stackPrimaryAlignItems?: StackJustify;
  readonly stackCounterAlignItems?: CounterAlign;
  readonly children: readonly ChildData[];
};

// Pre-computed layout data matching Figma's calculations. The names
// must match the keys in `LAYER_FILE_MAP` in
// `spec/layouts.spec.ts` — they are the test contract.
const TEST_CASES: readonly FrameData[] = [
  {
    name: "simple-rects",
    width: 200,
    height: 200,
    background: "#f2f2f2",
    children: [
      { name: "rect1", x: 20, y: 20, width: 60, height: 60, fill: "#6699e5" },
      { name: "rect2", x: 100, y: 80, width: 80, height: 40, fill: "#e58066" },
    ],
  },
  {
    name: "auto-h-min",
    width: 140,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    stackSpacing: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 40, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 50, y: 0, width: 40, height: 60, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 100, y: 0, width: 40, height: 50, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-h-center",
    width: 140,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    stackSpacing: 10,
    stackPrimaryAlignItems: "CENTER",
    stackCounterAlignItems: "CENTER",
    children: [
      { name: "red", x: 0, y: 80, width: 40, height: 40, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 50, y: 70, width: 40, height: 60, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 100, y: 75, width: 40, height: 50, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-h-max",
    width: 140,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    stackSpacing: 10,
    stackPrimaryAlignItems: "MAX",
    stackCounterAlignItems: "MAX",
    children: [
      { name: "red", x: 0, y: 160, width: 40, height: 40, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 50, y: 140, width: 40, height: 60, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 100, y: 150, width: 40, height: 50, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-v-min",
    width: 200,
    height: 110,
    background: "#f2f2f2",
    stackMode: "VERTICAL",
    stackSpacing: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 30, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 0, y: 40, width: 60, height: 30, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 0, y: 80, width: 50, height: 30, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-v-center",
    width: 200,
    height: 110,
    background: "#f2f2f2",
    stackMode: "VERTICAL",
    stackSpacing: 10,
    stackPrimaryAlignItems: "CENTER",
    stackCounterAlignItems: "CENTER",
    children: [
      { name: "red", x: 80, y: 0, width: 40, height: 30, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 70, y: 40, width: 60, height: 30, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 75, y: 80, width: 50, height: 30, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-v-max",
    width: 200,
    height: 110,
    background: "#f2f2f2",
    stackMode: "VERTICAL",
    stackSpacing: 10,
    stackPrimaryAlignItems: "MAX",
    stackCounterAlignItems: "MAX",
    children: [
      { name: "red", x: 160, y: 0, width: 40, height: 30, fill: "#e54d4d", cornerRadius: 4 },
      { name: "green", x: 140, y: 40, width: 60, height: 30, fill: "#4de54d", cornerRadius: 4 },
      { name: "blue", x: 150, y: 80, width: 50, height: 30, fill: "#4d4de5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-h-space-between",
    width: 120,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    stackSpacing: 10,
    stackPrimaryAlignItems: "SPACE_BETWEEN",
    stackCounterAlignItems: "CENTER",
    children: [
      { name: "orange", x: 0, y: 80, width: 40, height: 40, fill: "#e5994d", cornerRadius: 4 },
      { name: "lime", x: 40, y: 80, width: 40, height: 40, fill: "#99e54d", cornerRadius: 4 },
      { name: "sky", x: 80, y: 80, width: 40, height: 40, fill: "#4d99e5", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-gap-0",
    width: 150,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    children: [
      { name: "r1", x: 0, y: 0, width: 50, height: 50, fill: "#b24d4d", cornerRadius: 4 },
      { name: "r2", x: 50, y: 0, width: 50, height: 50, fill: "#4db24d", cornerRadius: 4 },
      { name: "r3", x: 100, y: 0, width: 50, height: 50, fill: "#4d4db2", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-gap-20",
    width: 160,
    height: 200,
    background: "#f2f2f2",
    stackMode: "HORIZONTAL",
    stackSpacing: 20,
    children: [
      { name: "r1", x: 0, y: 0, width: 40, height: 40, fill: "#b24d4d", cornerRadius: 4 },
      { name: "r2", x: 60, y: 0, width: 40, height: 40, fill: "#4db24d", cornerRadius: 4 },
      { name: "r3", x: 120, y: 0, width: 40, height: 40, fill: "#4d4db2", cornerRadius: 4 },
    ],
  },
  {
    name: "auto-padding-20",
    width: 200,
    height: 88,
    background: "#f2f2f2",
    stackMode: "VERTICAL",
    stackSpacing: 8,
    children: [
      { name: "r1", x: 0, y: 0, width: 80, height: 40, fill: "#9966cc", cornerRadius: 4 },
      { name: "r2", x: 0, y: 48, width: 80, height: 40, fill: "#6699cc", cornerRadius: 4 },
    ],
  },
  {
    name: "constraints-corners",
    width: 200,
    height: 200,
    background: "#f2f2f2",
    children: [
      { name: "tl", x: 10, y: 10, width: 30, height: 30, fill: "#e54d4d" },
      { name: "tr", x: 160, y: 10, width: 30, height: 30, fill: "#4de54d" },
      { name: "c", x: 85, y: 85, width: 30, height: 30, fill: "#e5e54d" },
      { name: "bl", x: 10, y: 160, width: 30, height: 30, fill: "#4d4de5" },
      { name: "br", x: 160, y: 160, width: 30, height: 30, fill: "#e54de5" },
    ],
  },
];

// =============================================================================
// Grid placement
// =============================================================================

// The original script laid the 12 frames out in a 4-column grid on
// the canvas. The integration test does not depend on absolute
// positions (each layer is re-wrapped into a synthetic CANVAS at
// render time), but the visual exporter (`Figma open → Export SVG`)
// does — we keep the same arrangement so a human regenerating the
// `actual/` SVGs from Figma sees the same layout.
const GRID_COLS = 4;
const GRID_GAP = 100;
const GRID_OFFSET_X = 100;
const GRID_OFFSET_Y = 100;

// =============================================================================
// Builder helpers
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
};

/**
 * Wrap an optional `StackJustify` into its Kiwi enum-value pair, or
 * leave it unset. Extracted from `buildAutoLayout` so the
 * conditional fits on a single line under the project's
 * `ternary-length` lint rule.
 */
function primaryAlignEnum(
  primary: StackJustify | undefined,
): { readonly value: number; readonly name: StackJustify } | undefined {
  if (!primary) {
    return undefined;
  }
  return { value: STACK_JUSTIFY_VALUES[primary], name: primary };
}

/**
 * Counterpart of {@link primaryAlignEnum} for the counter axis.
 */
function counterAlignEnum(
  counter: CounterAlign | undefined,
): { readonly value: number; readonly name: CounterAlign } | undefined {
  if (!counter) {
    return undefined;
  }
  return { value: STACK_ALIGN_VALUES[counter], name: counter };
}

/**
 * Build the `AutoLayoutProps` object for a frame. AutoLayout is
 * optional per test case — only frames that actually exercise an
 * auto-layout mode set this; the others render as plain
 * absolute-positioned containers.
 */
function buildAutoLayout(
  mode: StackMode,
  spacing: number | undefined,
  primary: StackJustify | undefined,
  counter: CounterAlign | undefined,
): AutoLayoutProps {
  return {
    stackMode: { value: STACK_MODE_VALUES[mode], name: mode },
    stackSpacing: spacing,
    stackPrimaryAlignItems: primaryAlignEnum(primary),
    stackCounterAlignItems: counterAlignEnum(counter),
  };
}

/**
 * Construct the auto-layout props for a test case, returning
 * `undefined` when the case has no `stackMode` set. Extracted out of
 * `addTestCase` so the call site uses a plain assignment rather than
 * a multi-line ternary (forbidden by `custom/ternary-length`).
 */
function autoLayoutFor(testCase: FrameData): AutoLayoutProps | undefined {
  if (!testCase.stackMode) {
    return undefined;
  }
  return buildAutoLayout(
    testCase.stackMode,
    testCase.stackSpacing,
    testCase.stackPrimaryAlignItems,
    testCase.stackCounterAlignItems,
  );
}

function addTestCase(
  doc: FigDesignDocument,
  ctx: Ctx,
  testCase: FrameData,
  index: number,
  maxWidth: number,
  maxHeight: number,
): FigDesignDocument {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  const x = GRID_OFFSET_X + col * (maxWidth + GRID_GAP);
  const y = GRID_OFFSET_Y + row * (maxHeight + GRID_GAP);

  const autoLayout = autoLayoutFor(testCase);

  const frame = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId: null,
    spec: {
      type: "FRAME",
      name: testCase.name,
      x,
      y,
      width: testCase.width,
      height: testCase.height,
      fills: [solidPaint(hexColor(testCase.background))],
      autoLayout,
    },
  });

  return testCase.children.reduce<FigDesignDocument>((acc, child) => {
    const result = addNode({
      state: ctx.state,
      doc: acc,
      pageId: ctx.pageId,
      parentId: frame.nodeId as FigNodeId,
      spec: {
        type: "ROUNDED_RECTANGLE",
        name: child.name,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
        fills: [solidPaint(hexColor(child.fill))],
        cornerRadius: child.cornerRadius ?? 0,
      },
    });
    return result.doc;
  }, frame.doc);
}

// =============================================================================
// Main
// =============================================================================

async function generate(): Promise<void> {
  console.log("Generating layout fixtures...\n");

  const empty = createEmptyFigDesignDocument("Layout Tests");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const ctx: Ctx = { state, pageId };

  // Figma's importer requires an Internal Only Canvas (see
  // packages/@higma-document-renderers/fig/CLAUDE.md → "Figma
  // インポートの必須要件"). All other migrated generators add it
  // first; we do the same so the page ordering matches a real
  // Figma export.
  const doc0 = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  console.log(`Creating ${TEST_CASES.length} test cases...\n`);

  const maxWidth = Math.max(...TEST_CASES.map((tc) => tc.width));
  const maxHeight = Math.max(...TEST_CASES.map((tc) => tc.height));

  const finalDoc = TEST_CASES.reduce<FigDesignDocument>((acc, testCase, index) => {
    console.log(
      `  [${index + 1}/${TEST_CASES.length}] ${testCase.name} (${testCase.width}x${testCase.height})`,
    );
    return addTestCase(acc, ctx, testCase, index, maxWidth, maxHeight);
  }, doc0);

  console.log("\nSaving...");
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`\nSaved: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.byteLength / 1024).toFixed(1)} KB`);
  console.log(`Test cases: ${TEST_CASES.length}`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
