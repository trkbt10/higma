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
import { parseFontStack, type FontResolver } from "./font-resolver";

/**
 * Resolve a captured CSS `font-family` value to a single concrete
 * family name via the injected resolver. The non-empty branch must
 * never fall back to "first comma-split candidate" — picking
 * `-apple-system` verbatim was the historical bug that produced the
 * yellow halo of pixel diffs on every captured glyph.
 *
 * `undefined` is allowed here (the inline-run merge path inherits
 * from the host when the inline element has no own `font-family`),
 * the empty-string-but-present branch is treated like absent — both
 * are signals that the inline element is *deferring* to its host.
 * The host's own font-family is read by `readBaseStyle` and goes
 * through the resolver explicitly.
 */
function resolveOrInherit(
  raw: string | undefined,
  resolver: FontResolver,
  inherited: string,
): string {
  if (raw === undefined || raw.trim().length === 0) {
    return inherited;
  }
  return resolver.resolve(parseFontStack(raw));
}

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
 *   - the tag is not a *structural* container whose box must
 *     survive as its own FRAME (table cells / rows / list items
 *     etc.)
 */
export function isParagraphHost(el: RawElement): boolean {
  if (!isBlockDisplay(el.computedStyle.display)) {
    return false;
  }
  if (isStructuralContainer(el)) {
    return false;
  }
  if (collectTextLength(el) === 0) {
    return false;
  }
  return everyDescendantIsInline(el);
}

/**
 * Tags whose layout role *is* their meaning — collapsing them
 * into a TEXT IR loses the surrounding table grid / list /
 * description structure even when the cell happens to carry only
 * inline text. Wikipedia's infobox is the canonical case: every
 * `<td>` is inline-text-only by content, but turning it into a
 * paragraph TEXT erases the table entirely. Same for
 * `<li>` / `<dt>` / `<dd>` (list items) and `<caption>` (table
 * caption).
 *
 * `<p>` / `<h1..6>` / generic `<div>` / `<blockquote>` / `<header>`
 * / `<footer>` etc. *are* paragraph-collapse candidates because
 * their box and their text content are interchangeable from a
 * design-tool perspective.
 */
const STRUCTURAL_TAGS = new Set([
  "td",
  "th",
  "tr",
  "tbody",
  "thead",
  "tfoot",
  "table",
  "caption",
  "li",
  "dt",
  "dd",
  "summary",
]);

function isStructuralContainer(el: RawElement): boolean {
  return STRUCTURAL_TAGS.has(el.tag);
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
  // Prefer textFragments so the count reflects what the ordered
  // walker will emit; fall back to the legacy `text` length when
  // the snapshot didn't supply fragments.
  const direct = el.textFragments
    ? el.textFragments.reduce((acc, slot) => acc + slot.length, 0)
    : (el.text ?? "").length;
  const pseudo = (el.pseudo ?? []).reduce((acc, p) => acc + p.text.length, 0);
  // Only count visible descendants — invisible children (e.g.
  // `<option>` inside a `<select>`, `display: none` siblings) do
  // not contribute glyphs to the host's paragraph. Without this
  // filter, a `<select>` whose options carry text labels was
  // mis-classified as a paragraph host with empty visible content,
  // producing a TEXT IR with `characters: ""` instead of a FRAME
  // representing the form control.
  const childTotal = el.children.reduce(
    (acc, child) => acc + (child.visible ? collectTextLength(child) : 0),
    0,
  );
  return direct + pseudo + childTotal;
}

/** Tags whose elements are inline-level but carry replaced content
 * (raster, vector, video, embedded frames). Paragraph collapse must
 * exclude any subtree that contains them, otherwise the surrounding
 * `<figure>` / `<a>` etc. become a TEXT IR node and the image is
 * silently dropped.
 */
const REPLACED_INLINE_TAGS = new Set([
  "img",
  "video",
  "picture",
  "canvas",
  "iframe",
  "object",
  "embed",
  "input",
]);

function everyDescendantIsInline(el: RawElement): boolean {
  for (const child of el.children) {
    if (!child.visible) {
      continue;
    }
    if (REPLACED_INLINE_TAGS.has(child.tag)) {
      return false;
    }
    if (child.svgContent !== undefined) {
      return false;
    }
    // An inline element that carries its own visible image
    // payload (CSS `background-image: url(...)` on `<a>` /
    // `<span>` / `<i>`, or a `mask-image` SVG that the decorator
    // already parsed) is acting as a replaced inline — paragraph
    // collapse here would discard the image entirely (TEXT IR
    // has no fill stack). Bail out so the surrounding parent
    // emits a FRAME and the inline keeps a child FRAME with the
    // image fill / mask vector.
    if (hasInlinePaintPayload(child)) {
      return false;
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

/**
 * Inline element carrying a visible image / mask paint that
 * paragraph collapse would silently drop. CSS-source signals:
 *   - `background-image` other than `none` / empty
 *   - `mask-image` (or vendor-prefixed `-webkit-mask-image`)
 *   - any decorated `maskSvgContent` / `imageId` on the snapshot
 *     (the latter covers data URIs that bypassed the literal
 *     `background-image` check above on edge cases)
 */
function hasInlinePaintPayload(el: RawElement): boolean {
  const cs = el.computedStyle;
  const bg = (cs["background-image"] ?? "none").trim();
  if (bg !== "none" && bg !== "") {
    return true;
  }
  const mask = (cs["mask-image"] ?? cs["-webkit-mask-image"] ?? "none").trim();
  if (mask !== "none" && mask !== "") {
    return true;
  }
  if (el.imageId !== undefined || el.maskImageId !== undefined) {
    return true;
  }
  return false;
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
 * base. `resolver` is invoked for every `font-family` value the
 * inline tree carries — both the paragraph host's and any inline
 * descendant that overrides the family — so the IR's runs end up
 * with concrete OS-installed family names rather than the raw CSS
 * fallback stacks the browser captures.
 */
export function buildParagraphContent(el: RawElement, resolver: FontResolver): ParagraphContent {
  const baseStyle = readBaseStyle(el, resolver);
  const writer = createWriter(baseStyle);
  walkInline(el, baseStyle, writer, resolver);
  return { characters: writer.characters(), runs: writer.runs() };
}

function readBaseStyle(el: RawElement, resolver: FontResolver): BaseStyle {
  const cs = el.computedStyle;
  const rawFamily = cs["font-family"];
  if (rawFamily === undefined || rawFamily.trim().length === 0) {
    throw new Error(
      `buildParagraphContent: paragraph host <${el.tag} id=${el.id}> has empty font-family — `
        + "computed style must always carry one per the CSS Fonts spec.",
    );
  }
  return {
    color: parseColor(cs.color ?? "rgb(0, 0, 0)"),
    fontFamily: resolver.resolve(parseFontStack(rawFamily)),
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
 * the inline ancestor's effective style. `::before` / `::after`
 * pseudo-element text is bracketed around the element's own text
 * + descendants, mirroring the CSS Generated Content rules.
 *
 * When `el.textFragments` is present we use it to interleave direct
 * text with inline children in document order (the case for
 * `<p>foo<a>bar</a>baz</p>` — the visible flow is foo·bar·baz, not
 * foobaz·bar). Otherwise we fall back to the legacy "all direct text
 * before all children" ordering used by leaf-text nodes.
 */
function walkInline(el: RawElement, base: BaseStyle, writer: RunWriter, resolver: FontResolver): void {
  // `<br>` inside a paragraph is an inline forced line break: CSS
  // semantics say it inserts a newline between the surrounding
  // text fragments. Without this branch the walker drops the `<br>`
  // entirely (it has no text and no children), and "line one<br>line
  // two" collapses to "line oneline two".
  if (el.tag === "br") {
    writer.push("\n", base);
    return;
  }
  const ownStyle = mergeStyle(el, base, resolver);
  pushPseudo(el, "before", ownStyle, writer, resolver);
  if (el.textFragments && el.textFragments.length === el.children.length + 1) {
    for (let i = 0; i < el.children.length; i += 1) {
      const slot = el.textFragments[i] ?? "";
      if (slot.length > 0) {
        writer.push(slot, ownStyle);
      }
      const child = el.children[i]!;
      if (!child.visible) {
        continue;
      }
      walkInline(child, ownStyle, writer, resolver);
    }
    const tail = el.textFragments[el.children.length] ?? "";
    if (tail.length > 0) {
      writer.push(tail, ownStyle);
    }
  } else {
    // Legacy path — leaf-text element (no children) or pre-fragment
    // snapshot data. Direct text comes first, then the inline
    // children in DOM order.
    if (el.text !== undefined && el.text.length > 0) {
      writer.push(el.text, ownStyle);
    }
    for (const child of el.children) {
      if (!child.visible) {
        continue;
      }
      walkInline(child, ownStyle, writer, resolver);
    }
  }
  pushPseudo(el, "after", ownStyle, writer, resolver);
}

function pushPseudo(
  el: RawElement,
  which: "before" | "after",
  hostStyle: BaseStyle,
  writer: RunWriter,
  resolver: FontResolver,
): void {
  const pseudoEntries = el.pseudo ?? [];
  for (const entry of pseudoEntries) {
    if (entry.which !== which) {
      continue;
    }
    const cs = entry.computedStyle;
    const style: BaseStyle = {
      color: cs.color ? parseColor(cs.color) : hostStyle.color,
      fontFamily: resolveOrInherit(cs["font-family"], resolver, hostStyle.fontFamily),
      fontWeight: cs["font-weight"] ? parseFontWeight(cs["font-weight"]) : hostStyle.fontWeight,
      fontStyle: extractFontStyle(cs["font-style"]) ?? hostStyle.fontStyle,
      textDecoration: cs["text-decoration-line"]
        ? extractDecoration(cs["text-decoration-line"])
        : hostStyle.textDecoration,
    };
    writer.push(entry.text, style);
  }
}

function mergeStyle(el: RawElement, base: BaseStyle, resolver: FontResolver): BaseStyle {
  const cs = el.computedStyle;
  return {
    color: cs.color ? parseColor(cs.color) : base.color,
    fontFamily: resolveOrInherit(cs["font-family"], resolver, base.fontFamily),
    fontWeight: cs["font-weight"] ? parseFontWeight(cs["font-weight"]) : base.fontWeight,
    fontStyle: extractFontStyle(cs["font-style"]) ?? base.fontStyle,
    textDecoration: cs["text-decoration-line"] ? extractDecoration(cs["text-decoration-line"]) : base.textDecoration,
  };
}
