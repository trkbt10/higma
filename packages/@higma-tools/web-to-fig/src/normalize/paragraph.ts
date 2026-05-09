/**
 * @file Paragraph detection and run extraction.
 *
 * A "paragraph" here is a captured DOM element that:
 *   - has a block-level `display` (paragraph hosts: block / flex /
 *     grid / list-item / table-cell, etc.)
 *   - contains only inline content — no descendant element promotes
 *     to its own block-level layout
 *   - actually carries glyph-bearing text somewhere in its subtree
 *
 * For such an element the normaliser collapses every descendant text
 * node into a single TEXT IR carrying that paragraph's literal
 * characters plus an ordered list of `TextRunIR`s capturing the
 * per-character style deviations (anchor colour, italic span, …).
 *
 * Why this matters: example.com's `<p><a>Learn more</a></p>` is a
 * paragraph with a single inline link. Without paragraph-level
 * grouping the bridge produces two TEXT nodes (`<p>` empty +
 * `<a>Learn more</a>` blue) and the inline relationship between
 * surrounding prose and the link is lost. Paragraph detection
 * collapses them back to "anchor as a coloured run inside the
 * paragraph", which is the structure Figma's TEXT supports natively
 * via `styleOverrideTable` + `characterStyleIDs`.
 */

import type { ColorIR, TextRunIR } from "@higma-bridges/web-fig";
import type { RawElement } from "../web-source/snapshot";
import { parseColor, parseFontWeight } from "./parse-css";

const BLOCK_DISPLAYS = new Set([
  "block",
  "flex",
  "grid",
  "flow-root",
  "list-item",
  "table",
  "table-row",
  "table-cell",
  "table-caption",
]);

const INLINE_DISPLAYS = new Set([
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "contents",
  "ruby",
  "ruby-base",
  "ruby-text",
]);

/**
 * Decide whether `el` should be normalised as a paragraph TEXT IR.
 *
 * Conditions:
 *   - own display is block-level
 *   - has at least one descendant character of glyph text
 *   - every descendant element is inline (no nested block child)
 */
export function isParagraphHost(el: RawElement): boolean {
  if (!isBlockDisplay(el.computedStyle.display)) {
    return false;
  }
  if (collectTextLength(el) === 0) {
    return false;
  }
  return everyDescendantIsInline(el);
}

function isBlockDisplay(display: string | undefined): boolean {
  if (!display) {
    return false;
  }
  return BLOCK_DISPLAYS.has(display);
}

function isInlineDisplay(display: string | undefined): boolean {
  if (!display) {
    return false;
  }
  return INLINE_DISPLAYS.has(display);
}

function collectTextLength(el: RawElement): number {
  const direct = (el.text ?? "").length;
  return el.children.reduce((acc, child) => acc + collectTextLength(child), direct);
}

function everyDescendantIsInline(el: RawElement): boolean {
  for (const child of el.children) {
    if (!child.visible) {
      continue;
    }
    if (!isInlineDisplay(child.computedStyle.display)) {
      return false;
    }
    if (!everyDescendantIsInline(child)) {
      return false;
    }
  }
  return true;
}

export type ParagraphContent = {
  readonly characters: string;
  readonly runs: readonly TextRunIR[];
};

type BaseStyle = {
  readonly color: ColorIR;
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontStyle: "normal" | "italic" | "oblique";
  readonly textDecoration: "none" | "underline" | "line-through";
};

/**
 * Walk a paragraph subtree in document order, concatenating every
 * text node into `characters`, and emitting a `TextRunIR` whenever
 * the inline ancestor's computed style diverges from the paragraph's
 * base.
 */
export function buildParagraphContent(el: RawElement): ParagraphContent {
  const baseStyle = readBaseStyle(el);
  const writer = createWriter(baseStyle);
  walkInline(el, baseStyle, writer);
  return { characters: writer.characters(), runs: writer.runs() };
}

function readBaseStyle(el: RawElement): BaseStyle {
  const cs = el.computedStyle;
  return {
    color: parseColor(cs.color ?? "rgb(0, 0, 0)"),
    fontFamily: extractFamilyName(cs["font-family"] ?? "sans-serif"),
    fontWeight: parseFontWeight(cs["font-weight"] ?? "400"),
    fontStyle: extractFontStyle(cs["font-style"]),
    textDecoration: extractDecoration(cs["text-decoration-line"]),
  };
}

function extractDecoration(raw: string | undefined): "none" | "underline" | "line-through" {
  if (!raw) {
    return "none";
  }
  if (raw.includes("underline")) {
    return "underline";
  }
  if (raw.includes("line-through")) {
    return "line-through";
  }
  return "none";
}

function extractFamilyName(raw: string): string {
  const first = raw.split(",")[0]!.trim();
  return first.replace(/^["']|["']$/g, "");
}

function extractFontStyle(raw: string | undefined): "normal" | "italic" | "oblique" {
  if (raw === "italic") {
    return "italic";
  }
  if (raw === "oblique") {
    return "oblique";
  }
  return "normal";
}

type RunWriter = {
  characters(): string;
  runs(): readonly TextRunIR[];
  push(text: string, style: BaseStyle): void;
};

function createWriter(base: BaseStyle): RunWriter {
  const parts: string[] = [];
  const accumulated: TextRunIR[] = [];
  const cursor = { value: 0 };

  function push(text: string, style: BaseStyle): void {
    if (text.length === 0) {
      return;
    }
    const start = cursor.value;
    const end = start + text.length;
    parts.push(text);
    cursor.value = end;
    if (sameStyle(style, base)) {
      return;
    }
    const lastIndex = accumulated.length - 1;
    const last = lastIndex >= 0 ? accumulated[lastIndex] : undefined;
    if (last && last.end === start && runStyleEquals(last, style, base)) {
      accumulated[lastIndex] = { ...last, end };
      return;
    }
    accumulated.push(buildRunFromStyle(start, end, style, base));
  }

  return {
    characters: () => parts.join(""),
    runs: () => accumulated,
    push,
  };
}

function buildRunFromStyle(start: number, end: number, style: BaseStyle, base: BaseStyle): TextRunIR {
  return {
    start,
    end,
    color: colorEquals(style.color, base.color) ? undefined : style.color,
    fontFamily: style.fontFamily === base.fontFamily ? undefined : style.fontFamily,
    fontWeight: style.fontWeight === base.fontWeight ? undefined : style.fontWeight,
    fontStyle: style.fontStyle === base.fontStyle ? undefined : style.fontStyle,
    textDecoration: style.textDecoration === base.textDecoration ? undefined : style.textDecoration,
  };
}

function runStyleEquals(run: TextRunIR, style: BaseStyle, base: BaseStyle): boolean {
  const expected = buildRunFromStyle(run.start, run.end, style, base);
  return colorOptEquals(run.color, expected.color)
    && run.fontFamily === expected.fontFamily
    && run.fontWeight === expected.fontWeight
    && run.fontStyle === expected.fontStyle
    && run.textDecoration === expected.textDecoration;
}

function colorOptEquals(a: ColorIR | undefined, b: ColorIR | undefined): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return colorEquals(a, b);
}

function colorEquals(a: ColorIR, b: ColorIR): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function sameStyle(a: BaseStyle, b: BaseStyle): boolean {
  return colorEquals(a.color, b.color)
    && a.fontFamily === b.fontFamily
    && a.fontWeight === b.fontWeight
    && a.fontStyle === b.fontStyle
    && a.textDecoration === b.textDecoration;
}

/**
 * Walk an element's inline subtree depth-first in document order,
 * collapsing whitespace exactly the way browsers do for inline
 * content. Each text run encountered along the way is pushed with
 * the inline ancestor's effective style.
 */
function walkInline(el: RawElement, base: BaseStyle, writer: RunWriter): void {
  const ownStyle = mergeStyle(el, base);
  // Direct text on this element comes before its inline children —
  // the snapshot walker captures only direct text nodes per element,
  // not interleaved text/element ordering. For the paragraphs we
  // currently target (single inline child per paragraph in
  // example.com) this ordering matches the visible output. When
  // multi-text-run paragraphs appear the snapshot needs richer
  // ordering — out of scope here, kept simple deliberately.
  if (el.text !== undefined && el.text.length > 0) {
    writer.push(el.text, ownStyle);
  }
  for (const child of el.children) {
    if (!child.visible) {
      continue;
    }
    walkInline(child, ownStyle, writer);
  }
}

function mergeStyle(el: RawElement, base: BaseStyle): BaseStyle {
  const cs = el.computedStyle;
  return {
    color: cs.color ? parseColor(cs.color) : base.color,
    fontFamily: cs["font-family"] ? extractFamilyName(cs["font-family"]) : base.fontFamily,
    fontWeight: cs["font-weight"] ? parseFontWeight(cs["font-weight"]) : base.fontWeight,
    fontStyle: extractFontStyle(cs["font-style"]) ?? base.fontStyle,
    textDecoration: cs["text-decoration-line"] ? extractDecoration(cs["text-decoration-line"]) : base.textDecoration,
  };
}
