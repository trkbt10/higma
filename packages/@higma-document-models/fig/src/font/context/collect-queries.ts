/**
 * @file Collect every distinct `FontQuery` referenced by a tree of
 * Figma nodes (raw `FigNode` or domain `FigDesignNode`), including
 * per-character `styleOverrideTable.fontName` overrides and SYMBOL
 * definitions that INSTANCE nodes resolve to.
 *
 * This is the single SoT for "which fonts does this subtree need?".
 * Anywhere else in the codebase that re-walks a tree to gather TEXT
 * fonts is duplicating this and will drift on edge cases (overrides,
 * INSTANCE recursion, symbol cycles).
 */

import { figmaFontToQuery, fontQueryKey, type FontQuery } from "../query";
import type { FigFontName, FigGuid, FigNode } from "../../types";
import type { FigDesignNode, TextStyleOverride } from "../../domain/document";

/**
 * Structural shape that both `FigNode` (raw kiwi) and `FigDesignNode`
 * (domain) satisfy. Keeping the input loose lets callers pass either
 * representation without converting.
 */
type FontBearingNode = {
  readonly type?: { readonly name?: string } | string;
  readonly fontName?: FigFontName;
  readonly textData?: {
    readonly fontName?: FigFontName;
    readonly styleOverrideTable?: readonly { readonly fontName?: FigFontName }[];
  };
  readonly children?: readonly (FontBearingNode | FigNode | FigDesignNode | undefined | null)[];
  readonly symbolId?: unknown;
  readonly symbolData?: { readonly symbolID?: unknown };
  readonly guid?: FigGuid;
  readonly id?: string;
};

export type CollectFontQueriesInput = {
  /** Root nodes to walk. Either `FigNode[]` or `FigDesignNode[]`. */
  readonly roots: readonly (FontBearingNode | FigNode | FigDesignNode | undefined | null)[];
  /**
   * Symbol definitions reachable via `INSTANCE` references. Pass the
   * document-wide map (FigDesignDocument.components, raw nodeMap, etc.).
   * Keys are the same string ids INSTANCE nodes carry. Pass `undefined`
   * to skip INSTANCE-symbol recursion entirely.
   */
  readonly symbolMap?: ReadonlyMap<string, FontBearingNode | FigNode | FigDesignNode> | undefined;
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

  function walk(node: FontBearingNode | FigNode | FigDesignNode | undefined | null): void {
    if (!node) {
      return;
    }
    const typed = node as FontBearingNode;
    if (nodeTypeName(typed) === "TEXT") {
      // Base font: prefer the structured `textData.fontName` (FigDesignNode
      // / parsed FigNode after conversion), otherwise the raw top-level
      // `fontName` field (raw FigNode).
      const baseFontName: FigFontName | undefined = typed.textData?.fontName ?? typed.fontName;
      if (baseFontName !== undefined) {
        pushQuery(figmaFontToQuery(baseFontName));
      }
      // Per-character override fonts.
      const overrideTable = typed.textData?.styleOverrideTable;
      if (overrideTable) {
        for (const override of overrideTable) {
          if (override.fontName !== undefined) {
            pushQuery(figmaFontToQuery(override.fontName));
          }
        }
      }
    }
    // INSTANCE → resolved SYMBOL: walk the symbol body's TEXT nodes too.
    if (nodeTypeName(typed) === "INSTANCE" && input.symbolMap !== undefined) {
      const symbolKey = readSymbolKey(typed);
      if (symbolKey !== undefined && !visitedSymbols.has(symbolKey)) {
        visitedSymbols.add(symbolKey);
        const symbol = input.symbolMap.get(symbolKey);
        if (symbol !== undefined) {
          walk(symbol as FontBearingNode);
        }
      }
    }
    const children = typed.children;
    if (children) {
      for (const child of children) {
        walk(child);
      }
    }
  }

  for (const root of input.roots) {
    walk(root);
  }

  return { queries };
}

/**
 * Read the node `type.name` regardless of whether the input is a
 * domain `FigDesignNode` (string) or raw `FigNode` (KiwiEnumValue).
 */
function nodeTypeName(node: FontBearingNode): string | undefined {
  const t = node.type;
  if (typeof t === "string") {
    return t;
  }
  return t?.name;
}

/**
 * Extract the symbol key an INSTANCE node references.
 *
 * `FigDesignNode.symbolId` is a branded string. Raw `FigNode` carries
 * `symbolData.symbolID` whose serialised form depends on the kiwi
 * type (tuple `{ sessionID, localID }`). We only resolve the
 * already-stringified path here — raw kiwi symbol resolution must be
 * done by the caller before passing the map in.
 */
function readSymbolKey(node: FontBearingNode): string | undefined {
  if (typeof node.symbolId === "string") {
    return node.symbolId;
  }
  return undefined;
}

/** Re-export for callers that want to filter override entries themselves. */
export type { TextStyleOverride };
