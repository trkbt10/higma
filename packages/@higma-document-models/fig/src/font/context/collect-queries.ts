/**
 * @file Collect every distinct `FontQuery` referenced by Kiwi
 * Kiwi FigNode values, including per-character
 * `styleOverrideTable.fontName` overrides and SYMBOL definitions that
 * INSTANCE nodes resolve to.
 *
 * This is the single SoT for:
 *   - which font identities the Kiwi document references, and
 *   - which of those identities must be supplied by a font loader
 *     because Kiwi's derived text payload is not sufficient.
 * Anywhere else in the codebase that re-walks nodes to gather TEXT
 * fonts is duplicating this and will drift on edge cases (overrides,
 * INSTANCE recursion, symbol cycles).
 */

import { figmaFontToQuery, figmaTextFontToQuery, fontQueryKey, type FontQuery } from "../query";
import type { FigFontName, FigKiwiVariableModeBySetMap, FigNode } from "../../types";
import { getNodeType, guidToString } from "../../domain";
import { mergeVariableModeBySetMap, type SymbolResolver } from "../../symbols";

/**
 * Minimal TEXT-bearing subset read by this module. It is intentionally
 * Kiwi-shaped: Symbol traversal goes through SymbolResolver instead of
 * accepting an external symbol map.
 */
type FontBearingNode = {
  readonly type?: { readonly name?: string } | string;
  readonly fontName?: FigFontName;
  readonly characters?: string;
  readonly derivedTextData?: FigNode["derivedTextData"];
  readonly textTruncation?: FigNode["textTruncation"];
  readonly textData?: {
    readonly characters?: string;
    readonly fontName?: FigFontName;
    readonly textTruncation?: FigNode["textTruncation"];
    readonly styleOverrideTable?: readonly { readonly styleID: number; readonly fontName?: FigFontName }[];
  };
  readonly children?: readonly (FontBearingNode | FigNode | undefined | null)[];
};

export type CollectFontQueriesInput = {
  /** Root Kiwi nodes to walk. */
  readonly roots: readonly FigNode[];
  /** SymbolResolver is the only authority for INSTANCE bodies. */
  readonly symbolResolver: SymbolResolver;
  /** Parent/child view over the Kiwi document. */
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
};

export type CollectFontQueriesResult = {
  /** Distinct font identities referenced by TEXT nodes, in walk order. */
  readonly queries: readonly FontQuery[];
  /**
   * Subset of `queries` that must be preloaded into a TextFontResolver.
   * A TEXT node whose Kiwi `derivedTextData` already carries line metrics,
   * line positions, and glyph outlines can render without a font loader;
   * missing derived data keeps the query here so render/edit paths fail
   * fast on a missing font instead of silently estimating.
   */
  readonly fontResolverQueries: readonly FontQuery[];
};

/**
 * Walk `roots` and gather every distinct `FontQuery` referenced by a
 * TEXT node — base font, per-run override fonts inside
 * `textData.styleOverrideTable`, and TEXT nodes inside SYMBOL
 * definitions reachable via INSTANCE references.
 *
 * Empty `family` queries are skipped — they signal "no fontName
 * present" (e.g. an empty TEXT placeholder) and would never resolve
 * through a loader.
 */
export function collectFontQueries(input: CollectFontQueriesInput): CollectFontQueriesResult {
  const seen = new Set<string>();
  const fontResolverSeen = new Set<string>();
  const queries: FontQuery[] = [];
  const fontResolverQueries: FontQuery[] = [];
  const activeSymbols = new Set<string>();

  function pushQuery(q: FontQuery): void {
    if (q.family.length === 0) {
      return;
    }
    const key = fontQueryKey(q);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queries.push(q);
  }

  function pushFontResolverQuery(q: FontQuery): void {
    if (q.family.length === 0) {
      return;
    }
    const key = fontQueryKey(q);
    if (fontResolverSeen.has(key)) {
      return;
    }
    fontResolverSeen.add(key);
    fontResolverQueries.push(q);
  }

  function collectTextNodeFonts(node: FontBearingNode): void {
    const baseFontName: FigFontName | undefined = node.textData?.fontName ?? node.fontName;
    const metadataFontName = node.derivedTextData?.fontMetaData?.[0]?.key?.family;
    const nodeQueries: FontQuery[] = [];
    if (baseFontName !== undefined || metadataFontName !== undefined) {
      nodeQueries.push(figmaTextFontToQuery(baseFontName, node.derivedTextData?.fontMetaData));
    }
    for (const override of node.textData?.styleOverrideTable ?? []) {
      if (override.fontName !== undefined) {
        nodeQueries.push(figmaFontToQuery(override.fontName));
      }
    }
    for (const query of nodeQueries) {
      pushQuery(query);
    }
    if (textNodeRequiresFontResolver(node)) {
      for (const query of nodeQueries) {
        pushFontResolverQuery(query);
      }
    }
  }

  function walk(
    node: FigNode | undefined | null,
    childrenOf: (node: FigNode) => readonly FigNode[],
    inheritedVariableModeBySetMap: FigKiwiVariableModeBySetMap | undefined,
  ): void {
    if (!node) {
      return;
    }
    const variableModeBySetMap = mergeVariableModeBySetMap(inheritedVariableModeBySetMap, node.variableModeBySetMap);
    const typed = node as FontBearingNode;
    if (getNodeType(node) === "TEXT") {
      collectTextNodeFonts(typed);
    }
    if (getNodeType(node) === "INSTANCE") {
      walkResolvedInstance(node, variableModeBySetMap);
      return;
    }
    for (const child of childrenOf(node)) {
      walk(child, childrenOf, variableModeBySetMap);
    }
  }

  function walkResolvedInstance(
    node: FigNode,
    variableModeBySetMap: FigKiwiVariableModeBySetMap | undefined,
  ): void {
    const scope = { variableModeBySetMap };
    const reference = input.symbolResolver.resolveReferences(node, scope).effectiveSymbol;
    if (reference === undefined) {
      const resolved = input.symbolResolver.resolveInstance(node, scope);
      for (const child of resolved.children) {
        walk(child, input.symbolResolver.childrenOfResolvedNode, variableModeBySetMap);
      }
      return;
    }
    if (reference.node.guid === undefined) {
      throw new Error("collectFontQueries: resolved SYMBOL node has no Kiwi guid.");
    }
    const key = guidToString(reference.node.guid);
    if (activeSymbols.has(key)) {
      return;
    }
    activeSymbols.add(key);
    try {
      const resolved = input.symbolResolver.resolveInstance(node, scope);
      for (const child of resolved.children) {
        walk(child, input.symbolResolver.childrenOfResolvedNode, variableModeBySetMap);
      }
    } finally {
      activeSymbols.delete(key);
    }
  }

  for (const root of input.roots) {
    walk(root, input.childrenOf, undefined);
  }

  return { queries, fontResolverQueries };
}

function textNodeRequiresFontResolver(node: FontBearingNode): boolean {
  if (textCharacters(node).length === 0) {
    return false;
  }
  if (hasDerivedTruncation(node)) {
    return true;
  }
  return !hasKiwiTextRenderingPayload(node.derivedTextData);
}

function textCharacters(node: FontBearingNode): string {
  return node.textData?.characters ?? node.characters ?? "";
}

function hasDerivedTruncation(node: FontBearingNode): boolean {
  const truncationStart = node.derivedTextData?.truncationStartIndex;
  if (typeof truncationStart === "number" && truncationStart >= 0) {
    return true;
  }
  const mode = node.textTruncation ?? node.textData?.textTruncation;
  if (typeof mode === "string") {
    return mode === "ENDING";
  }
  return mode?.name === "ENDING";
}

function hasKiwiTextRenderingPayload(derivedTextData: FigNode["derivedTextData"]): boolean {
  return hasDerivedFontMetrics(derivedTextData) &&
    hasDerivedLineMetrics(derivedTextData) &&
    hasDerivedGlyphs(derivedTextData);
}

function hasDerivedFontMetrics(derivedTextData: FigNode["derivedTextData"]): boolean {
  const baseline = derivedTextData?.baselines?.[0];
  const metadata = derivedTextData?.fontMetaData?.[0];
  return typeof baseline?.lineAscent === "number" &&
    Number.isFinite(baseline.lineAscent) &&
    typeof baseline.lineHeight === "number" &&
    Number.isFinite(baseline.lineHeight) &&
    baseline.lineHeight > 0 &&
    typeof metadata?.fontLineHeight === "number" &&
    Number.isFinite(metadata.fontLineHeight) &&
    metadata.fontLineHeight > 0;
}

function hasDerivedLineMetrics(derivedTextData: FigNode["derivedTextData"]): boolean {
  const baselines = derivedTextData?.baselines;
  if (!Array.isArray(baselines) || baselines.length === 0) {
    return false;
  }
  return baselines.every((baseline) => (
    typeof baseline.firstCharacter === "number" &&
    typeof baseline.endCharacter === "number" &&
    baseline.firstCharacter >= 0 &&
    baseline.endCharacter >= baseline.firstCharacter &&
    typeof baseline.width === "number" &&
    Number.isFinite(baseline.width) &&
    baseline.width >= 0 &&
    typeof baseline.position?.x === "number" &&
    Number.isFinite(baseline.position.x) &&
    typeof baseline.position.y === "number" &&
    Number.isFinite(baseline.position.y)
  ));
}

function hasDerivedGlyphs(derivedTextData: FigNode["derivedTextData"]): boolean {
  return Array.isArray(derivedTextData?.glyphs) && derivedTextData.glyphs.length > 0;
}
