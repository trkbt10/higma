#!/usr/bin/env bun
/**
 * @file Generate fixtures/text-styling/text-styling.fig
 *
 * Existing text fixtures (`text-comprehensive`, `text-webgl`,
 * `components`, `inherit`) only carry the default text-styling
 * enum members:
 *
 *   - `textCase`        — never set (always ORIGINAL)
 *   - `textDecoration`  — never set (always NONE)
 *   - `textAutoResize`  — never set (the builder defaults to
 *                         WIDTH_AND_HEIGHT and no fixture overrides
 *                         it)
 *   - `styleRuns`       — never set (no text fixture exercises
 *                         per-run styling)
 *
 * The roundtrip and renderer code paths still depend on every
 * one of those enum values being legally encodable. This fixture
 * exercises every member so any future regression surfaces here.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-text-styling-fixtures.ts
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
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { FigTextStyleOverrideEntry } from "@higma-document-models/fig/types";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";
import {
  TEXT_AUTO_RESIZE_VALUES,
  TEXT_CASE_VALUES,
  TEXT_DECORATION_VALUES,
  type TextAutoResize,
  type TextCase,
  type TextDecoration,
} from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/text-styling");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "text-styling.fig");

const FRAME_BG: FigColor = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const BLACK: FigColor = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const RED: FigColor = { r: 0.85, g: 0.15, b: 0.15, a: 1 };
const BLUE: FigColor = { r: 0.15, g: 0.3, b: 0.85, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return { type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" }, color, opacity: 1, visible: true, blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" } };
}

type CaseSpec = { readonly name: string; readonly value: TextCase; readonly text: string };
const TEXT_CASES: readonly CaseSpec[] = [
  { name: "case-original", value: "ORIGINAL", text: "Original Case" },
  { name: "case-upper", value: "UPPER", text: "Upper Case" },
  { name: "case-lower", value: "LOWER", text: "Lower Case" },
  { name: "case-title", value: "TITLE", text: "Title Case Words" },
  { name: "case-small-caps", value: "SMALL_CAPS", text: "Small Caps" },
  { name: "case-small-caps-forced", value: "SMALL_CAPS_FORCED", text: "Small Caps Forced" },
];

type DecorationSpec = { readonly name: string; readonly value: TextDecoration; readonly text: string };
const TEXT_DECORATIONS: readonly DecorationSpec[] = [
  { name: "deco-none", value: "NONE", text: "No decoration" },
  { name: "deco-underline", value: "UNDERLINE", text: "Underlined" },
  { name: "deco-strikethrough", value: "STRIKETHROUGH", text: "Strikethrough" },
];

type AutoResizeSpec = { readonly name: string; readonly value: TextAutoResize; readonly text: string };
const AUTO_RESIZE: readonly AutoResizeSpec[] = [
  { name: "resize-none", value: "NONE", text: "Fixed size box" },
  { name: "resize-width-and-height", value: "WIDTH_AND_HEIGHT", text: "Auto width + height" },
  { name: "resize-height", value: "HEIGHT", text: "Auto height only — text wraps inside the fixed width" },
];

/**
 * Per-run override descriptor. The Kiwi TEXT node carries this data via
 * `textData.characterStyleIDs` + `textData.styleOverrideTable`.
 */
type StyleRunSpec = {
  readonly start: number;
  readonly end: number;
  readonly fillColor: FigColor;
  readonly fontName?: { family: string; style: string };
};

type AddTextOpts = {
  readonly name: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly textCase?: TextCase;
  readonly decoration?: TextDecoration;
  readonly autoResize?: TextAutoResize;
  readonly styleRuns?: readonly StyleRunSpec[];
};

function pickTextDecoration<T>(
  name: TextDecoration | undefined,
  currentValue: T,
): T | { value: number; name: TextDecoration } {
  if (!name) {return currentValue;}
  return { value: TEXT_DECORATION_VALUES[name], name };
}

function pickTextAutoResize<T>(
  name: TextAutoResize | undefined,
  currentValue: T,
): T | { value: number; name: TextAutoResize } {
  if (!name) {return currentValue;}
  return { value: TEXT_AUTO_RESIZE_VALUES[name], name };
}

function addStyledText(
  state: FigBuilderState,
  context: FigDocumentContext,
  pageGuid: FigGuid,
  parentGuid: FigGuid,
  opts: AddTextOpts,
): FigDocumentContext {
  const added = addNode({
    state,
    context,
    pageGuid,
    parentGuid,
    spec: {
      type: "TEXT",
      name: opts.name,
      characters: opts.text,
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 16,
      fills: [solidPaint(BLACK)],
      x: opts.x,
      y: opts.y,
      width: opts.width ?? 320,
      height: 24,
    },
  });

  const needsTextDataPatch =
    opts.textCase !== undefined ||
    opts.decoration !== undefined ||
    opts.autoResize !== undefined ||
    opts.styleRuns !== undefined;
  if (!needsTextDataPatch) {
    return added.context;
  }

  return updateNode({
    context: added.context,
    nodeGuid: added.nodeGuid,
    update: (n) => {
      const td = n.textData;
      if (!td) {
        return n;
      }
      // Translate styleRuns → characterStyleIDs + styleOverrideTable.
      // Each unique run becomes one row in the override table, keyed
      // by a 1-based styleID; characters outside any run keep the
      // base style (sentinel 0).
      const runs = opts.styleRuns;
      const characterStyleIDs = runs ? buildCharacterStyleIDs(opts.text, runs) : td.characterStyleIDs;
      const styleOverrideTable = runs ? buildStyleOverrideTable(runs) : td.styleOverrideTable;
      return {
        ...n,
        textData: {
          ...td,
          textCase: opts.textCase ? { value: TEXT_CASE_VALUES[opts.textCase], name: opts.textCase } : td.textCase,
          textDecoration: pickTextDecoration(opts.decoration, td.textDecoration),
          textAutoResize: pickTextAutoResize(opts.autoResize, td.textAutoResize),
          characterStyleIDs,
          styleOverrideTable,
        },
      };
    },
  });
}

function buildCharacterStyleIDs(text: string, runs: readonly StyleRunSpec[]): readonly number[] {
  // Default each character to 0 (base style); rewrite spans covered
  // by each run with their 1-based styleID. We map each character
  // index → the highest styleID whose run covers it (later runs win
  // when ranges overlap, matching the legacy builder's last-write
  // semantics).
  return Array.from({ length: text.length }, (_, i) => {
    const hit = runs.reduce<{ readonly id: number }>(
      (acc, run, index) =>
        i >= run.start && i < run.end ? { id: index + 1 } : acc,
      { id: 0 },
    );
    return hit.id;
  });
}

function buildStyleOverrideTable(runs: readonly StyleRunSpec[]): readonly FigTextStyleOverrideEntry[] {
  return runs.map((run, index) => {
    const fontName = run.fontName ? { family: run.fontName.family, style: run.fontName.style } : undefined;
    const entry: FigTextStyleOverrideEntry = {
      styleID: index + 1,
      fillPaints: [solidPaint(run.fillColor)],
      ...(fontName ? { fontName } : {}),
    };
    return entry;
  });
}

function addRowFrame(
  state: FigBuilderState,
  context: FigDocumentContext,
  pageGuid: FigGuid,
  opts: { readonly name: string; readonly y: number; readonly height: number },
): { readonly context: FigDocumentContext; readonly frameId: FigGuid } {
  const r = addNode({
    state,
    context,
    pageGuid,
    parentGuid: null,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: 80,
      y: opts.y,
      width: 720,
      height: opts.height,
      fills: [solidPaint(FRAME_BG)],
      clipsContent: true,
    },
  });
  return { context: r.context, frameId: r.nodeGuid };
}

async function generate(): Promise<void> {
  console.log("Generating text-styling fixture...");

  const empty = createEmptyFigDocument("Text Styling");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Text Styling").guid;
  const contextWithInternal = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const caseFrame = addRowFrame(state, contextWithInternal, pageGuid, {
    name: "text-case",
    y: 80,
    height: TEXT_CASES.length * 36 + 32,
  });
  const contextAfterCases = TEXT_CASES.reduce<FigDocumentContext>(
    (acc, c, index) =>
      addStyledText(state, acc, pageGuid, caseFrame.frameId, {
        name: c.name,
        text: c.text,
        x: 24,
        y: 16 + index * 36,
        textCase: c.value,
      }),
    caseFrame.context,
  );

  const decoFrame = addRowFrame(state, contextAfterCases, pageGuid, {
    name: "text-decoration",
    y: 80 + TEXT_CASES.length * 36 + 64,
    height: TEXT_DECORATIONS.length * 36 + 32,
  });
  const contextAfterDecorations = TEXT_DECORATIONS.reduce<FigDocumentContext>(
    (acc, d, index) =>
      addStyledText(state, acc, pageGuid, decoFrame.frameId, {
        name: d.name,
        text: d.text,
        x: 24,
        y: 16 + index * 36,
        decoration: d.value,
      }),
    decoFrame.context,
  );

  const resizeFrame = addRowFrame(state, contextAfterDecorations, pageGuid, {
    name: "auto-resize",
    y: 80 + TEXT_CASES.length * 36 + 64 + TEXT_DECORATIONS.length * 36 + 64,
    height: AUTO_RESIZE.length * 60 + 32,
  });
  const contextAfterResize = AUTO_RESIZE.reduce<FigDocumentContext>(
    (acc, a, index) =>
      addStyledText(state, acc, pageGuid, resizeFrame.frameId, {
        name: a.name,
        text: a.text,
        x: 24,
        y: 16 + index * 60,
        width: 280,
        autoResize: a.value,
      }),
    resizeFrame.context,
  );

  // Mixed-style runs: a single TEXT node carrying three contiguous
  // overrides so per-character style data round-trips.
  const runsFrame = addRowFrame(state, contextAfterResize, pageGuid, {
    name: "style-runs",
    y: 80 + TEXT_CASES.length * 36 + 64 + TEXT_DECORATIONS.length * 36 + 64 + AUTO_RESIZE.length * 60 + 64,
    height: 80,
  });
  const characters = "RED green BLUE";
  const styleRuns: readonly StyleRunSpec[] = [
    { start: 0, end: 3, fillColor: RED },
    { start: 4, end: 9, fillColor: { r: 0.15, g: 0.7, b: 0.15, a: 1 } },
    { start: 10, end: 14, fillColor: BLUE },
  ];
  const finalContext = addStyledText(state, runsFrame.context, pageGuid, runsFrame.frameId, {
    name: "mixed-runs",
    text: characters,
    x: 24,
    y: 24,
    styleRuns,
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
  console.log(`Frames: 4 (text-case, text-decoration, auto-resize, style-runs)`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
