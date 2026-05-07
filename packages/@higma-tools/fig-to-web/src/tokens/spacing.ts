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
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { RadiusToken, SpacingToken } from "./types";

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Walk the targeted subtrees and collect spacing tokens. */
export function buildSpacingTokens(usageNodes: readonly FigNode[]): SpacingTokenTable {
  const counts = new Map<number, number>();
  for (const node of usageNodes) {
    visit(node, counts);
  }
  const tokens = new Map<string, SpacingToken>();
  for (const [value, hits] of counts) {
    if (hits < MIN_USES_FOR_TOKEN) {
      continue;
    }
    const id = `spacing-${formatNumber(value)}`;
    tokens.set(id, { id, value });
  }
  return { tokens };
}

function visit(node: FigNode, counts: Map<number, number>): void {
  recordValue(counts, node.stackSpacing);
  recordValue(counts, node.stackPadding);
  recordValue(counts, node.stackVerticalPadding);
  recordValue(counts, node.stackHorizontalPadding);
  recordValue(counts, node.stackPaddingRight);
  recordValue(counts, node.stackPaddingBottom);
  recordValue(counts, node.stackCounterSpacing);
  for (const child of node.children ?? []) {
    if (child) {
      visit(child, counts);
    }
  }
}

/** Walk the targeted subtrees and collect corner-radius tokens. */
export function buildRadiusTokens(usageNodes: readonly FigNode[]): RadiusTokenTable {
  const counts = new Map<number, number>();
  for (const node of usageNodes) {
    visitRadii(node, counts);
  }
  const tokens = new Map<string, RadiusToken>();
  for (const [value, hits] of counts) {
    if (hits < MIN_USES_FOR_TOKEN) {
      continue;
    }
    const id = `radius-${formatNumber(value)}`;
    tokens.set(id, { id, value });
  }
  return { tokens };
}

function visitRadii(node: FigNode, counts: Map<number, number>): void {
  recordValue(counts, node.cornerRadius);
  for (const radius of node.rectangleCornerRadii ?? []) {
    recordValue(counts, radius);
  }
  recordValue(counts, node.rectangleTopLeftCornerRadius);
  recordValue(counts, node.rectangleTopRightCornerRadius);
  recordValue(counts, node.rectangleBottomLeftCornerRadius);
  recordValue(counts, node.rectangleBottomRightCornerRadius);
  for (const child of node.children ?? []) {
    if (child) {
      visitRadii(child, counts);
    }
  }
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
