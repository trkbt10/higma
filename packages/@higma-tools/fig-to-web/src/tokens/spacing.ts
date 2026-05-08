/**
 * @file Spacing + radius token extraction.
 *
 * Both kinds derive from numeric px values used at multiple sites
 * across the targeted subtrees. We refuse to emit single-use anonymous
 * tokens for these — a one-shot 11px gap is just an inline value, not
 * a reusable design decision. The threshold is configurable but
 * defaults to 2 (pair-or-more). Single-use values are still allowed
 * through inline; they simply do not get a token.
 *
 * Naming uses the px value verbatim: `--spacing-8`, `--radius-12`.
 * Negative values (e.g. negative gap) are not expected from auto-layout
 * and would not survive `Math.round` collapse, so they are rejected.
 *
 * Spacing and radius walkers share one recursive shell — the only
 * thing that differs between them is *which* numeric fields each
 * extracts from a node. Encoding that as a `collect` callback keeps
 * the recursion in one place; before the SoT extract this file had
 * two near-identical recursive functions and the indexion-refactor
 * audit flagged them as 85% structural duplicates.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { RadiusToken, SpacingToken } from "./types";
import { round2 } from "../lib/css-format/numeric";

export type SpacingTokenTable = {
  readonly tokens: ReadonlyMap<string, SpacingToken>;
};

export type RadiusTokenTable = {
  readonly tokens: ReadonlyMap<string, RadiusToken>;
};

const MIN_USES_FOR_TOKEN = 2;

function recordValue(map: Map<number, number>, value: number | undefined): void {
  if (typeof value !== "number") {
    return;
  }
  if (value < 0) {
    return;
  }
  if (!Number.isFinite(value)) {
    return;
  }
  const rounded = round2(value);
  map.set(rounded, (map.get(rounded) ?? 0) + 1);
}

/**
 * Recursive walker shared by spacing and radius collection.
 * `collect` decides which numeric fields contribute to the count for
 * the current node; the walker handles the tree descent so neither
 * caller needs to re-implement child recursion.
 */
function visitTree(
  node: FigNode,
  counts: Map<number, number>,
  collect: (node: FigNode, record: (value: number | undefined) => void) => void,
): void {
  collect(node, (value) => recordValue(counts, value));
  for (const child of node.children ?? []) {
    if (child) {
      visitTree(child, counts, collect);
    }
  }
}

/**
 * Tally numeric values across the subtree per the supplied collector,
 * keep only those used at least `MIN_USES_FOR_TOKEN` times, and
 * materialise them as `<prefix>-<value>` tokens. Both spacing and
 * radius collection follow this exact shape — the only thing that
 * varies is the field set the collector reads.
 */
function tallyTokens<T extends { readonly id: string; readonly value: number }>(
  usageNodes: readonly FigNode[],
  prefix: string,
  collect: (node: FigNode, record: (value: number | undefined) => void) => void,
): ReadonlyMap<string, T> {
  const counts = new Map<number, number>();
  for (const node of usageNodes) {
    visitTree(node, counts, collect);
  }
  const tokens = new Map<string, T>();
  for (const [value, hits] of counts) {
    if (hits < MIN_USES_FOR_TOKEN) {
      continue;
    }
    const id = `${prefix}-${formatNumber(value)}`;
    tokens.set(id, { id, value } as T);
  }
  return tokens;
}

function collectSpacing(node: FigNode, record: (value: number | undefined) => void): void {
  record(node.stackSpacing);
  record(node.stackPadding);
  record(node.stackVerticalPadding);
  record(node.stackHorizontalPadding);
  record(node.stackPaddingRight);
  record(node.stackPaddingBottom);
  record(node.stackCounterSpacing);
}

function collectRadii(node: FigNode, record: (value: number | undefined) => void): void {
  record(node.cornerRadius);
  for (const radius of node.rectangleCornerRadii ?? []) {
    record(radius);
  }
  record(node.rectangleTopLeftCornerRadius);
  record(node.rectangleTopRightCornerRadius);
  record(node.rectangleBottomLeftCornerRadius);
  record(node.rectangleBottomRightCornerRadius);
}

/** Walk the targeted subtrees and collect spacing tokens. */
export function buildSpacingTokens(usageNodes: readonly FigNode[]): SpacingTokenTable {
  return { tokens: tallyTokens<SpacingToken>(usageNodes, "spacing", collectSpacing) };
}

/** Walk the targeted subtrees and collect corner-radius tokens. */
export function buildRadiusTokens(usageNodes: readonly FigNode[]): RadiusTokenTable {
  return { tokens: tallyTokens<RadiusToken>(usageNodes, "radius", collectRadii) };
}

/**
 * Format a px value for use inside a CSS-variable name. Whole numbers
 * stay as-is; fractional values use a `_` separator so the resulting
 * id remains a valid CSS ident (no `.`).
 */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) {
    return String(n);
  }
  return String(n).replace(".", "_");
}

/** Resolve a px spacing value to its token id, when one exists. */
export function lookupSpacingId(table: SpacingTokenTable, value: number): string | undefined {
  const id = `spacing-${formatNumber(round2(value))}`;
  return table.tokens.has(id) ? id : undefined;
}

/** Resolve a px radius value to its token id, when one exists. */
export function lookupRadiusId(table: RadiusTokenTable, value: number): string | undefined {
  const id = `radius-${formatNumber(round2(value))}`;
  return table.tokens.has(id) ? id : undefined;
}
