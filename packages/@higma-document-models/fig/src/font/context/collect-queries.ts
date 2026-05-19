/**
 * @file Collect every distinct `FontQuery` referenced by Kiwi
 * Kiwi FigNode values, including per-character
 * `styleOverrideTable.fontName` overrides and SYMBOL definitions that
 * INSTANCE nodes resolve to.
 *
 * This is the single SoT for "which fonts do these nodes need?".
 * Anywhere else in the codebase that re-walks nodes to gather TEXT
 * fonts is duplicating this and will drift on edge cases (overrides,
 * INSTANCE recursion, symbol cycles).
 */

import { figmaFontToQuery, fontQueryKey, type FontQuery } from "../query";
import type { FigFontName, FigNode } from "../../types";
import { getNodeType, guidToString } from "../../domain";
import type { SymbolResolver } from "../../symbols";

/**
 * Minimal TEXT-bearing subset read by this module. It is intentionally
 * Kiwi-shaped: Symbol traversal goes through SymbolResolver instead of
 * accepting an external symbol map.
 */
type FontBearingNode = {
  readonly type?: { readonly name?: string } | string;
  readonly fontName?: FigFontName;
  readonly textData?: {
    readonly fontName?: FigFontName;
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
  /** Distinct queries in walk order. */
  readonly queries: readonly FontQuery[];
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
  const queries: FontQuery[] = [];
  const visitedSymbols = new Set<string>();

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

  function collectTextNodeFonts(node: FontBearingNode): void {
    const baseFontName: FigFontName | undefined = node.textData?.fontName ?? node.fontName;
    if (baseFontName !== undefined) {
      pushQuery(figmaFontToQuery(baseFontName));
    }
    for (const override of node.textData?.styleOverrideTable ?? []) {
      if (override.fontName !== undefined) {
        pushQuery(figmaFontToQuery(override.fontName));
      }
    }
  }

  function walkResolvedChildren(children: readonly FigNode[]): void {
    for (const child of children) {
      walk(child, input.symbolResolver.childrenOfResolvedNode);
    }
  }

  function walk(node: FigNode | undefined | null, childrenOf: (node: FigNode) => readonly FigNode[]): void {
    if (!node) {
      return;
    }
    const typed = node as FontBearingNode;
    if (getNodeType(node) === "TEXT") {
      collectTextNodeFonts(typed);
    }
    if (getNodeType(node) === "INSTANCE") {
      const reference = input.symbolResolver.resolveReferences(node).effectiveSymbol;
      walkInstanceReference(node, reference);
      return;
    }
    for (const child of childrenOf(node)) {
      walk(child, childrenOf);
    }
  }

  function walkInstanceReference(
    node: FigNode,
    reference: ReturnType<SymbolResolver["resolveReferences"]>["effectiveSymbol"],
  ): void {
    if (reference === undefined) {
      return;
    }
    if (reference.node.guid === undefined) {
      throw new Error("collectFontQueries: resolved SYMBOL node has no Kiwi guid.");
    }
    const key = guidToString(reference.node.guid);
    if (visitedSymbols.has(key)) {
      return;
    }
    visitedSymbols.add(key);
    const resolved = input.symbolResolver.resolveInstance(node);
    walkResolvedChildren(resolved.children);
  }

  for (const root of input.roots) {
    walk(root, input.childrenOf);
  }

  return { queries };
}
