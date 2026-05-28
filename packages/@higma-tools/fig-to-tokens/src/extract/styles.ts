/**
 * @file Collect Figma Styles (paint / text / effect) as `Token`s.
 *
 * Walks `document.nodeChanges` directly to enumerate style-definition
 * nodes — the same shape `buildFigStyleRegistry` indexes for lookup,
 * but the iteration here is name-first so the emitted token paths
 * mirror the style's Figma name (e.g. `"Brand/Primary 50"`).
 *
 * Coverage in this iteration:
 *   - FILL styles with a single visible SOLID paint → `color` token.
 *   - TEXT styles → composite `typography` token (font family / size
 *     / weight / optional line-height + letter-spacing).
 *   - EFFECT styles whose effects are shadow-shaped → `shadow` token
 *     with the same multi-layer CSS-string concatenation
 *     `fig-to-web/tokens/effect.ts` produces.
 *
 * Out of scope (skipped silently, can be added later):
 *   - Gradient / image FILL or STROKE styles.
 *   - STROKE styles in general (paint colour already covers SOLID via
 *     the FILL path; a STROKE-typed solid would duplicate it).
 *   - Blur effects (LAYER_BLUR / FOREGROUND_BLUR / BACKGROUND_BLUR).
 *   - GRID styles (opaque to the registry).
 */

import type {
  FigColor,
  FigEffect,
  FigNode,
  FigPaint,
} from "@higma-document-models/fig/types";
import { asSolidPaint } from "@higma-document-models/fig/color";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { Token, TokenValue, TypographyValue } from "../token-set";
import { buildCssId, buildTokenPath } from "./name";

const STYLE_DEFAULT_MODE = "default";

/** Enumerate paint / text / effect style-definition nodes and project them to `Token`s. */
export function extractStyleTokens(document: FigKiwiDocumentIndex): readonly Token[] {
  const tokens: Token[] = [];
  for (const node of document.nodeChanges) {
    const styleType = node.styleType?.name;
    if (!styleType) {
      continue;
    }
    const token = projectStyleNodeToToken(node, styleType);
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

function projectStyleNodeToToken(node: FigNode, styleType: string): Token | undefined {
  const name = node.name;
  if (!name || name.trim().length === 0) {
    return undefined;
  }
  const value = projectStyleValue(node, styleType);
  if (!value) {
    return undefined;
  }
  const path = buildTokenPath(name);
  const cssId = buildCssId(name);
  const valuesByMode = new Map<string, TokenValue>([[STYLE_DEFAULT_MODE, value]]);
  return {
    path,
    cssId,
    source: "style",
    variableSetSlug: null,
    variableSetName: null,
    valuesByMode,
    defaultModeName: STYLE_DEFAULT_MODE,
  };
}

function projectStyleValue(node: FigNode, styleType: string): TokenValue | undefined {
  if (styleType === "FILL") {
    return projectFillStyleValue(node.fillPaints);
  }
  if (styleType === "TEXT") {
    return projectTextStyleValue(node);
  }
  if (styleType === "EFFECT") {
    return projectEffectStyleValue(node.effects);
  }
  return undefined;
}

function projectFillStyleValue(paints: readonly FigPaint[] | undefined): TokenValue | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    const solid = asSolidPaint(paint);
    if (solid === undefined) {
      // Gradient / image paint styles need richer emit shapes;
      // skipping until the consumer reports a need.
      continue;
    }
    const opacity = typeof solid.opacity === "number" ? solid.opacity : 1;
    const composed: FigColor = { ...solid.color, a: solid.color.a * opacity };
    return { kind: "color", css: figColorToCss(composed) };
  }
  return undefined;
}

function projectTextStyleValue(node: FigNode): TypographyValue | undefined {
  const family = node.fontName?.family ?? null;
  const styleString = node.fontName?.style ?? null;
  const fontSize = node.fontSize;
  if (!family || fontSize === undefined) {
    return undefined;
  }
  const lineHeight = formatLineHeight(node.lineHeight);
  const letterSpacing = formatLetterSpacing(node.letterSpacing);
  return {
    kind: "typography",
    fontFamily: quoteFontFamily(family),
    fontWeight: inferFontWeight(styleString),
    fontSize: `${fontSize}px`,
    lineHeight,
    letterSpacing,
  };
}

function projectEffectStyleValue(effects: readonly FigEffect[] | undefined): TokenValue | undefined {
  const segments = (effects ?? [])
    .map(shadowEffectToCss)
    .filter((s): s is string => s !== undefined);
  if (segments.length === 0) {
    return undefined;
  }
  return { kind: "shadow", css: segments.join(", ") };
}

function shadowEffectToCss(effect: FigEffect): string | undefined {
  const type = kiwiEnumName(effect.type, "FigEffect.type");
  if (type !== "DROP_SHADOW" && type !== "INNER_SHADOW") {
    return undefined;
  }
  if (effect.visible === false) {
    return undefined;
  }
  const offsetX = effect.offset?.x ?? 0;
  const offsetY = effect.offset?.y ?? 0;
  const blur = effect.radius ?? 0;
  const spread = effect.spread ?? 0;
  const color = effect.color ?? { r: 0, g: 0, b: 0, a: 1 };
  const inset = type === "INNER_SHADOW" ? "inset " : "";
  return `${inset}${formatPx(offsetX)} ${formatPx(offsetY)} ${formatPx(blur)} ${formatPx(spread)} ${figColorToCss(color)}`;
}

function formatLineHeight(lineHeight: FigNode["lineHeight"]): string | undefined {
  if (lineHeight === undefined) {
    return undefined;
  }
  const unitName = kiwiEnumName(lineHeight.units, "FigLineHeight.units");
  if (unitName === "AUTO") {
    return "normal";
  }
  if (unitName === "PIXELS") {
    return lineHeight.value === undefined ? undefined : `${lineHeight.value}px`;
  }
  if (unitName === "PERCENT" || unitName === "RAW") {
    return lineHeight.value === undefined ? undefined : `${lineHeight.value}%`;
  }
  return undefined;
}

function formatLetterSpacing(letterSpacing: FigNode["letterSpacing"]): string | undefined {
  if (letterSpacing === undefined || letterSpacing.value === undefined) {
    return undefined;
  }
  if (letterSpacing.value === 0) {
    return undefined;
  }
  const unitName = kiwiEnumName(letterSpacing.units, "FigLetterSpacing.units");
  if (unitName === "PERCENT") {
    return `${(letterSpacing.value / 100).toFixed(3)}em`;
  }
  return `${letterSpacing.value}px`;
}

function inferFontWeight(styleString: string | null): number | undefined {
  if (!styleString) {
    return undefined;
  }
  const lower = styleString.toLowerCase();
  // Order matters — longer matches first so "extrabold" wins over
  // "bold". The table reflects Figma's standard PostScript style
  // names; OpenType variable axes give finer-grained weights, but
  // those are emitted by the renderer's font-variation pipeline, not
  // this token snapshot.
  const TABLE: readonly (readonly [string, number])[] = [
    ["thin", 100],
    ["hairline", 100],
    ["extralight", 200],
    ["ultralight", 200],
    ["light", 300],
    ["regular", 400],
    ["normal", 400],
    ["book", 400],
    ["medium", 500],
    ["demibold", 600],
    ["semibold", 600],
    ["bold", 700],
    ["extrabold", 800],
    ["ultrabold", 800],
    ["heavy", 900],
    ["black", 900],
  ];
  for (const [needle, weight] of TABLE) {
    if (lower.includes(needle)) {
      return weight;
    }
  }
  return undefined;
}

function quoteFontFamily(family: string): string {
  // Single token, but the simplest portable form is to quote the
  // family name. Consumers can layer their own fallback stack.
  return `"${family.replace(/"/g, '\\"')}"`;
}

function formatPx(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) {
    return `${Math.round(value)}px`;
  }
  return `${value.toFixed(2)}px`;
}

function figColorToCss(color: FigColor): string {
  const r = clampUnit(color.r);
  const g = clampUnit(color.g);
  const b = clampUnit(color.b);
  const a = clampUnit(color.a);
  if (a >= 0.9995) {
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  return `rgba(${ri}, ${gi}, ${bi}, ${trimDecimal(a, 3)})`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function toHex2(unit: number): string {
  return Math.round(unit * 255).toString(16).padStart(2, "0");
}

function trimDecimal(value: number, places: number): string {
  return Number(value.toFixed(places)).toString();
}
