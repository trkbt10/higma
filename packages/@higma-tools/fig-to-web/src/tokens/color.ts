/**
 * @file Color-token extraction.
 *
 * Two sources flow into the color token table, in priority order:
 *
 * 1. **Style proxies** — Figma keeps shared FILL styles as nodes on the
 *    Internal Only Canvas. Each carries a human-authored `name` like
 *    `"Primary Color/Black"` and the resolved `fillPaints`. These give
 *    the design system its named colour vocabulary, so they win the
 *    bare slug (e.g. `--color-primary-color-black`).
 *
 * 2. **Usage colours** — Any SOLID fill / stroke that is not already
 *    covered by a style proxy. Anonymous tokens get an
 *    auto-incrementing id (`--color-c1`, `--color-c2`, ...). The
 *    extractor only emits an anonymous token when a colour is observed
 *    at least once in the targeted subtrees, so unused colours stay
 *    out of the generated stylesheet.
 *
 * Equality of colours is decided at 3-decimal precision (≈ 1/1000),
 * which is finer than the 1/255 sRGB step and keeps gradient stops with
 * tiny rounding differences from getting their own token. Alpha is
 * folded into the same key.
 */
import type { FigColor, FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { ColorToken, TokenColor } from "./types";
import { toCssSlug, uniqueId } from "./name";
import { clamp01, round3 } from "../lib/css-format/numeric";

/** 3-decimal canonical form, used as a Map key. */
function colorKey(color: FigColor): string {
  return `${round3(color.r)},${round3(color.g)},${round3(color.b)},${round3(color.a)}`;
}

function toTokenColor(color: FigColor): TokenColor {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

/**
 * Extract a colour token from a SOLID paint.
 *
 * Visible/opacity-aware: invisible paints are skipped because the JSX
 * emitter will not reference them either. The paint's own opacity is
 * folded into alpha so a single token captures both intrinsic colour
 * and per-paint opacity.
 */
function paintToColor(paint: FigPaint): FigColor | undefined {
  if (paint.type !== "SOLID") {
    return undefined;
  }
  if (paint.visible === false) {
    return undefined;
  }
  const baseAlpha = paint.color.a;
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  return {
    r: paint.color.r,
    g: paint.color.g,
    b: paint.color.b,
    a: clamp01(baseAlpha * paintOpacity),
  };
}


export type ColorTokenTable = {
  readonly tokens: ReadonlyMap<string, ColorToken>;
  /** Map from canonical colour key → token id. */
  readonly idByKey: ReadonlyMap<string, string>;
};

/**
 * Build the color-token table.
 *
 * `styleProxies` is the list of Internal-Only-Canvas children whose
 * `styleType.name === "FILL"`; pass them in the order Figma stored
 * them so the visible Figma library order is preserved.
 *
 * `usageNodes` is the set of nodes the emitter will actually walk —
 * passing only those keeps anonymous tokens minimal.
 */
export function buildColorTokens(
  styleProxies: readonly FigNode[],
  usageNodes: readonly FigNode[],
): ColorTokenTable {
  const tokens = new Map<string, ColorToken>();
  const idByKey = new Map<string, string>();
  const usedIds = new Set<string>();

  for (const proxy of styleProxies) {
    const fills = proxy.fillPaints ?? [];
    for (const paint of fills) {
      const color = paintToColor(paint);
      if (!color) {
        continue;
      }
      const key = colorKey(color);
      if (idByKey.has(key)) {
        continue;
      }
      const figmaName = proxy.name ?? "color";
      const slug = toCssSlug(figmaName);
      const id = uniqueId(`color-${slug}`, usedIds);
      tokens.set(id, { id, source: "style", figmaName, value: toTokenColor(color) });
      idByKey.set(key, id);
    }
  }

  collectUsageColors(usageNodes, tokens, idByKey, usedIds);

  return { tokens, idByKey };
}

function collectUsageColors(
  nodes: readonly FigNode[],
  tokens: Map<string, ColorToken>,
  idByKey: Map<string, string>,
  usedIds: Set<string>,
): void {
  for (const node of nodes) {
    visitColors(node, tokens, idByKey, usedIds);
  }
}

function visitColors(
  node: FigNode,
  tokens: Map<string, ColorToken>,
  idByKey: Map<string, string>,
  usedIds: Set<string>,
): void {
  registerPaints(node.fillPaints, tokens, idByKey, usedIds);
  registerPaints(node.backgroundPaints, tokens, idByKey, usedIds);
  registerPaints(node.strokePaints, tokens, idByKey, usedIds);
  for (const child of node.children ?? []) {
    if (child) {
      visitColors(child, tokens, idByKey, usedIds);
    }
  }
}

function registerPaints(
  paints: readonly FigPaint[] | undefined,
  tokens: Map<string, ColorToken>,
  idByKey: Map<string, string>,
  usedIds: Set<string>,
): void {
  if (!paints) {
    return;
  }
  for (const paint of paints) {
    const color = paintToColor(paint);
    if (!color) {
      continue;
    }
    const key = colorKey(color);
    if (idByKey.has(key)) {
      continue;
    }
    const ordinal = idByKey.size + 1;
    const id = uniqueId(`color-c${ordinal}`, usedIds);
    tokens.set(id, { id, source: "usage", value: toTokenColor(color) });
    idByKey.set(key, id);
  }
}

/** Resolve a SOLID paint to its colour-token id (when one exists). */
export function lookupColorId(table: ColorTokenTable, paint: FigPaint): string | undefined {
  const color = paintToColor(paint);
  if (!color) {
    return undefined;
  }
  return table.idByKey.get(colorKey(color));
}
