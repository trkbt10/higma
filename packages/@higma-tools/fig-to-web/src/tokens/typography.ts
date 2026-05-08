/**
 * @file Typography token extraction.
 *
 * Each unique combination of (family, style, fontSize, lineHeight,
 * letterSpacing) used by a TEXT node becomes one typography token.
 * Tokens are de-duplicated across the entire walked subtree so two
 * frames sharing a heading style emit it only once.
 *
 * Naming strategy — chosen to round-trip cleanly to design-tool
 * conventions while remaining readable in CSS:
 *
 *   "Inter" / "Bold" / 24px → `text-inter-bold-24`
 *   "Inter" / "Regular" / 14px → `text-inter-regular-14`
 *
 * Collisions on this base are resolved by `uniqueId`, which appends a
 * numeric suffix only when truly needed (rare but possible when two
 * shapes differ only by line-height or letter-spacing — that variation
 * forces a distinct id so the emitter does not collapse them).
 */
import type { FigFontName, FigNode, FigValueWithUnits } from "@higma-document-models/fig/types";
import type { TypographyToken } from "./types";
import { toCssSlug, uniqueId } from "./name";

/** Map common Figma weight-style strings to numeric font-weight. */
const WEIGHT_BY_STYLE: ReadonlyMap<string, number> = new Map([
  ["thin", 100],
  ["extralight", 200],
  ["ultralight", 200],
  ["light", 300],
  ["regular", 400],
  ["normal", 400],
  ["medium", 500],
  ["semibold", 600],
  ["demibold", 600],
  ["bold", 700],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["black", 900],
  ["heavy", 900],
]);

function styleToWeight(style: string): number | undefined {
  const normalised = style.toLowerCase().replace(/[^a-z]/g, "");
  return WEIGHT_BY_STYLE.get(normalised);
}

function lineHeightToCss(value: FigValueWithUnits | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  switch (value.units.name) {
    case "PIXELS":
      return `${round2(value.value)}px`;
    case "PERCENT":
      return `${round2(value.value)}%`;
    case "RAW":
      return `${round2(value.value)}`;
    case "AUTO":
      return "normal";
  }
  throw new Error(`typography: unknown lineHeight units "${value.units.name}"`);
}

function letterSpacingToCss(value: FigValueWithUnits | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.value === 0) {
    return undefined;
  }
  switch (value.units.name) {
    case "PIXELS":
      return `${round2(value.value)}px`;
    case "PERCENT":
      return `${round2(value.value / 100)}em`;
    case "RAW":
      return `${round2(value.value)}em`;
    case "AUTO":
      return undefined;
  }
  throw new Error(`typography: unknown letterSpacing units "${value.units.name}"`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type TypographyDescriptor = {
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontSize: number;
  readonly lineHeight?: string;
  readonly letterSpacing?: string;
};

export type TypographyTokenTable = {
  readonly tokens: ReadonlyMap<string, TypographyToken>;
  readonly idByKey: ReadonlyMap<string, string>;
};

function descriptorKey(d: TypographyDescriptor): string {
  return [
    d.fontFamily,
    d.fontStyle,
    d.fontSize,
    d.lineHeight ?? "",
    d.letterSpacing ?? "",
  ].join("|");
}

function describe(node: FigNode): TypographyDescriptor | undefined {
  const fontName = node.fontName as FigFontName | undefined;
  if (!fontName) {
    return undefined;
  }
  const fontSize = typeof node.fontSize === "number" ? node.fontSize : undefined;
  if (fontSize === undefined) {
    return undefined;
  }
  return {
    fontFamily: fontName.family,
    fontStyle: fontName.style,
    fontSize,
    lineHeight: lineHeightToCss(node.lineHeight),
    letterSpacing: letterSpacingToCss(node.letterSpacing),
  };
}

/** Walk the targeted subtrees and collect typography tokens. */
export function buildTypographyTokens(usageNodes: readonly FigNode[]): TypographyTokenTable {
  const tokens = new Map<string, TypographyToken>();
  const idByKey = new Map<string, string>();
  const usedIds = new Set<string>();

  for (const node of usageNodes) {
    visit(node, tokens, idByKey, usedIds);
  }
  return { tokens, idByKey };
}

function visit(
  node: FigNode,
  tokens: Map<string, TypographyToken>,
  idByKey: Map<string, string>,
  usedIds: Set<string>,
): void {
  if (node.type.name === "TEXT") {
    const descriptor = describe(node);
    if (descriptor) {
      register(descriptor, tokens, idByKey, usedIds);
    }
    // Run-level descriptors: when a TEXT node carries
    // `styleOverrideTable`, individual character ranges may use a
    // different font/size from the base. Each unique override style
    // needs its own typography token so the multi-span emitter can
    // reference it without re-deriving it at JSX time.
    for (const overrideDescriptor of describeRunOverrides(node, descriptor)) {
      register(overrideDescriptor, tokens, idByKey, usedIds);
    }
  }
  for (const child of node.children ?? []) {
    if (child) {
      visit(child, tokens, idByKey, usedIds);
    }
  }
}

/**
 * Yield typography descriptors implied by `styleOverrideTable` runs.
 *
 * Each override entry contributes the subset of fields the run
 * actually changes. Missing fields inherit from the node's base
 * descriptor (passed in as `base`), so a sparse override that only
 * sets `fontSize` still produces a complete typography descriptor
 * for tokenisation.
 */
function describeRunOverrides(
  node: FigNode,
  base: TypographyDescriptor | undefined,
): readonly TypographyDescriptor[] {
  if (!base) {
    return [];
  }
  const td = (node as Record<string, unknown>).textData as Record<string, unknown> | undefined;
  const sot = ((td?.styleOverrideTable ?? node.styleOverrideTable) as readonly RunOverrideEntry[] | undefined);
  if (!sot || sot.length === 0) {
    return [];
  }
  const cIds = ((td?.characterStyleIDs ?? node.characterStyleIDs) as readonly number[] | undefined);
  const referenced = referencedStyleIds(cIds);
  if (referenced.size === 0) {
    return [];
  }
  const out: TypographyDescriptor[] = [];
  for (const entry of sot) {
    if (!referenced.has(entry.styleID)) {
      continue;
    }
    const family = entry.fontName?.family ?? base.fontFamily;
    const style = entry.fontName?.style ?? base.fontStyle;
    const size = typeof entry.fontSize === "number" ? entry.fontSize : base.fontSize;
    const lineHeight = entry.lineHeight !== undefined ? lineHeightToCss(entry.lineHeight) : base.lineHeight;
    const letterSpacing = entry.letterSpacing !== undefined ? letterSpacingToCss(entry.letterSpacing) : base.letterSpacing;
    out.push({ fontFamily: family, fontStyle: style, fontSize: size, lineHeight, letterSpacing });
  }
  return out;
}

type RunOverrideEntry = {
  readonly styleID: number;
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  // `units` is a `KiwiEnumValue<string>` — `{ value, name }` — same
  // shape `FigValueWithUnits` carries. The earlier definition omitted
  // `value` and forced two callers to dig the field out via untyped
  // casts; keeping the field here lets `lineHeightToCss` /
  // `letterSpacingToCss` accept the entry directly.
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
};

function referencedStyleIds(cIds: readonly number[] | undefined): ReadonlySet<number> {
  if (!cIds) {
    return new Set();
  }
  const out = new Set<number>();
  for (const id of cIds) {
    if (id !== 0) {
      out.add(id);
    }
  }
  return out;
}

function register(
  d: TypographyDescriptor,
  tokens: Map<string, TypographyToken>,
  idByKey: Map<string, string>,
  usedIds: Set<string>,
): void {
  const key = descriptorKey(d);
  if (idByKey.has(key)) {
    return;
  }
  const familySlug = toCssSlug(d.fontFamily);
  const styleSlug = toCssSlug(d.fontStyle);
  const sizeSlug = `${Math.round(d.fontSize)}`;
  const id = uniqueId(`text-${familySlug}-${styleSlug}-${sizeSlug}`, usedIds);
  const token: TypographyToken = {
    id,
    fontFamily: d.fontFamily,
    fontStyle: d.fontStyle,
    fontWeight: styleToWeight(d.fontStyle),
    fontSize: d.fontSize,
    lineHeight: d.lineHeight,
    letterSpacing: d.letterSpacing,
  };
  tokens.set(id, token);
  idByKey.set(key, id);
}

/** Resolve a typography descriptor to its token id, when one is registered. */
export function lookupTypographyId(
  table: TypographyTokenTable,
  family: string,
  style: string,
  fontSize: number,
  lineHeight?: string,
  letterSpacing?: string,
): string | undefined {
  return table.idByKey.get(
    descriptorKey({ fontFamily: family, fontStyle: style, fontSize, lineHeight, letterSpacing }),
  );
}
