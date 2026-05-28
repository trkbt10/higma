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
  paintSpecToFig,
  requireCanvas,
  type FigDocumentContext,
  type SolidPaintSpec,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { FigTextStyleOverrideEntry } from "@higma-document-models/fig/types";
import type { FigColor } from "@higma-document-models/fig/types";
import type {
  LeadingTrim,
  TextAutoResize,
  TextCase,
  TextDecoration,
  TextTruncation,
} from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/text-styling");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "text-styling.fig");

const FRAME_BG: FigColor = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const BLACK: FigColor = { r: 0.1, g: 0.1, b: 0.1, a: 1 };
const RED: FigColor = { r: 0.85, g: 0.15, b: 0.15, a: 1 };
const BLUE: FigColor = { r: 0.15, g: 0.3, b: 0.85, a: 1 };

function solidPaint(color: FigColor): SolidPaintSpec {
  return { type: "SOLID", color, opacity: 1, visible: true };
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
  readonly height?: number;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly fontSize?: number;
  readonly textCase?: TextCase;
  readonly decoration?: TextDecoration;
  readonly autoResize?: TextAutoResize;
  readonly truncation?: TextTruncation;
  readonly leadingTrim?: LeadingTrim;
  readonly paragraphSpacing?: number;
  readonly paragraphIndent?: number;
  readonly styleRuns?: readonly StyleRunSpec[];
};

/**
 * Build a sequential y-cursor helper. Returns a function that hands
 * out the next row's y-coordinate given that row's height, advancing
 * its internal cursor by `height + gap`. Encapsulating the mutable
 * counter inside the closure means callers never need a top-level
 * `let` (forbidden by the project's lint rules) just to track the
 * current vertical offset between fixture frames.
 */
function createRowCursor(initialY: number, gap: number): (height: number) => number {
  const state = { y: initialY };
  return (height: number) => {
    const y = state.y;
    state.y = y + height + gap;
    return y;
  };
}

function addStyledText(
  state: FigBuilderState,
  context: FigDocumentContext,
  pageGuid: FigGuid,
  parentGuid: FigGuid,
  opts: AddTextOpts,
): FigDocumentContext {
  const fontSize = opts.fontSize ?? 16;
  const added = addNode({
    state,
    context,
    pageGuid,
    parentGuid,
    spec: {
      visible: true,
      opacity: 1,
      type: "TEXT",
      name: opts.name,
      characters: opts.text,
      // Noto Sans JP is shipped by Google Fonts (and macOS preinstalls
      // the same family), so it's the deterministic target across the
      // local dev machine and CI runners. Pinning every text fixture
      // to it minimises font-rendering noise in the visual harness —
      // the alternative ("Inter on macOS, fallback elsewhere") flipped
      // diff numbers by a percent or two between environments.
      fontFamily: opts.fontFamily ?? "Noto Sans JP",
      fontStyle: opts.fontStyle ?? "Regular",
      fontSize,
      // The factory requires an explicit `lineHeight` on every TEXT
      // spec — there is no implicit Figma default. 1.5x is the
      // CSS-equivalent of `line-height: 1.5` (the most common
      // designer choice for body copy) and matches what the rest of
      // the text fixtures use.
      lineHeight: fontSize * 1.5,
      fills: [solidPaint(BLACK)],
      x: opts.x,
      y: opts.y,
      width: opts.width ?? 320,
      height: opts.height ?? 24,
      textTruncation: opts.truncation,
      leadingTrim: opts.leadingTrim,
      paragraphSpacing: opts.paragraphSpacing,
      paragraphIndent: opts.paragraphIndent,
      textCase: opts.textCase,
      textDecoration: opts.decoration,
      textAutoResize: opts.autoResize,
    },
  });

  if (opts.styleRuns === undefined) {
    return added.context;
  }

  // Translate styleRuns → characterStyleIDs + styleOverrideTable. The
  // builder factory has no surface for character-level overrides
  // (Figma's `textData.styleOverrideTable` is a parallel store keyed
  // by 1-based styleID), so this stays as a post-construction patch
  // — but only for that one concern; every other text property is
  // resolved via the spec on insertion.
  return updateNode({
    context: added.context,
    nodeGuid: added.nodeGuid,
    update: (n) => {
      const td = n.textData;
      if (!td) {
        return n;
      }
      const runs = opts.styleRuns;
      const characterStyleIDs = runs ? buildCharacterStyleIDs(opts.text, runs) : td.characterStyleIDs;
      const styleOverrideTable = runs ? buildStyleOverrideTable(runs) : td.styleOverrideTable;
      return {
        ...n,
        textData: {
          ...td,
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
      fillPaints: [paintSpecToFig(solidPaint(run.fillColor))],
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
      visible: true,
      opacity: 1,
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
  const contextAfterRuns = addStyledText(state, runsFrame.context, pageGuid, runsFrame.frameId, {
    name: "mixed-runs",
    text: characters,
    x: 24,
    y: 24,
    styleRuns,
  });

  // Track the y-cursor explicitly from here on so each new frame
  // appends below the previous one without restating the running
  // total. Wrapping the cursor in a closure means the consumer hands
  // each frame's height in once and reads its y-offset back — the
  // mutable counter stays inside the helper rather than leaking out
  // as a `let` in the calling scope.
  const RUNS_FRAME_TOP = 80 + TEXT_CASES.length * 36 + 64 + TEXT_DECORATIONS.length * 36 + 64 + AUTO_RESIZE.length * 60 + 64;
  const RUNS_FRAME_HEIGHT = 80;
  const FRAME_GAP = 64;
  const takeRow = createRowCursor(RUNS_FRAME_TOP + RUNS_FRAME_HEIGHT + FRAME_GAP, FRAME_GAP);

  // Truncation: `textTruncation: ENDING` on a fixed-height box wraps
  // the text inside the bounds, then cuts the final visible line with
  // an ellipsis when the box runs out of vertical space. Pair it with
  // `autoResize: NONE` (fixed bounds) so the truncation actually fires
  // — `WIDTH_AND_HEIGHT` would grow the box instead of clipping.
  const truncationFrame = addRowFrame(state, contextAfterRuns, pageGuid, {
    name: "text-truncation",
    y: takeRow(80),
    height: 80,
  });
  const contextAfterTruncation = addStyledText(state, truncationFrame.context, pageGuid, truncationFrame.frameId, {
    name: "truncation-ending",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent aliquet dapibus ligula, at facilisis ex sagittis ut. Mauris id vestibulum risus. Nulla facilisi.",
    x: 24,
    y: 16,
    width: 260,
    height: 48,
    autoResize: "NONE",
    truncation: "ENDING",
  });

  // Vertical leading trim: `CAP_HEIGHT` crops the empty space above
  // the cap line and below the baseline, so the bounding box visually
  // hugs the glyphs. The control line below it (NONE) keeps Figma's
  // default leading so a visual diff highlights exactly the gutter
  // change.
  const leadingTrimFrame = addRowFrame(state, contextAfterTruncation, pageGuid, {
    name: "leading-trim",
    y: takeRow(110),
    height: 110,
  });
  const contextAfterTrimNone = addStyledText(state, leadingTrimFrame.context, pageGuid, leadingTrimFrame.frameId, {
    name: "leading-trim-none",
    text: "Default leading",
    x: 24,
    y: 16,
    width: 260,
    height: 36,
    fontSize: 24,
    leadingTrim: "NONE",
  });
  const contextAfterTrimCap = addStyledText(state, contextAfterTrimNone, pageGuid, leadingTrimFrame.frameId, {
    name: "leading-trim-cap",
    text: "Cap-height trimmed",
    x: 24,
    y: 60,
    width: 260,
    height: 36,
    fontSize: 24,
    leadingTrim: "CAP_HEIGHT",
  });

  // Paragraph spacing: extra vertical gutter inserted between
  // paragraphs (separated by `\n`). Default is 0 so two paragraphs
  // hug. Set to 16 here so the gap is visible alongside a 16px font.
  const paragraphFrame = addRowFrame(state, contextAfterTrimCap, pageGuid, {
    name: "paragraph-spacing",
    y: takeRow(140),
    height: 140,
  });
  const contextAfterParaSpacing = addStyledText(state, paragraphFrame.context, pageGuid, paragraphFrame.frameId, {
    name: "paragraph-spacing-16",
    text: "First paragraph.\nSecond paragraph.\nThird paragraph.",
    x: 24,
    y: 16,
    width: 260,
    height: 110,
    paragraphSpacing: 16,
  });

  // Paragraph indent: first-line indent in pixels. Combined with a
  // small paragraph-spacing so the indent on each paragraph after
  // the first is visually clean. Wikipedia-style article opener.
  const indentFrame = addRowFrame(state, contextAfterParaSpacing, pageGuid, {
    name: "paragraph-indent",
    y: takeRow(140),
    height: 140,
  });
  const contextAfterIndent = addStyledText(state, indentFrame.context, pageGuid, indentFrame.frameId, {
    name: "paragraph-indent-24",
    text: "First paragraph with no indent on the first line.\nSecond paragraph — note the first-line shift.\nThird paragraph also shifted.",
    x: 24,
    y: 16,
    width: 260,
    height: 110,
    paragraphSpacing: 8,
    paragraphIndent: 24,
  });

  // CJK glyph coverage: Noto Sans JP is bundled with macOS / shipped
  // by Google Fonts and is the realistic test target for Japanese
  // text. The frame pairs a JIS X 4051 line-break-rule excerpt with a
  // Wikipedia-style sentence so the renderer is exercised against
  // both punctuation-tight and prose-loose CJK content.
  const cjkFrame = addRowFrame(state, contextAfterIndent, pageGuid, {
    name: "cjk-noto-sans-jp",
    y: takeRow(140),
    height: 140,
  });
  const contextAfterCjkBold = addStyledText(state, cjkFrame.context, pageGuid, cjkFrame.frameId, {
    name: "cjk-jis-x-4051",
    text: "吾輩は猫である。名前はまだ無い。",
    x: 24,
    y: 16,
    width: 260,
    height: 36,
    fontFamily: "Noto Sans JP",
    fontStyle: "Bold",
    fontSize: 16,
  });
  const finalContext = addStyledText(state, contextAfterCjkBold, pageGuid, cjkFrame.frameId, {
    name: "cjk-wikipedia",
    text: "ウィキペディアへようこそ。誰でも編集できるフリー百科事典です。",
    x: 24,
    y: 64,
    width: 260,
    height: 60,
    fontFamily: "Noto Sans JP",
    fontStyle: "Bold",
    fontSize: 14,
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
  console.log(
    `Frames: 9 (text-case, text-decoration, auto-resize, style-runs, text-truncation, leading-trim, paragraph-spacing, paragraph-indent, cjk-noto-sans-jp)`,
  );
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
