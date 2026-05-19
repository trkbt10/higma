/**
 * @file Shadow / effect token extraction.
 *
 * Figma offers DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, FOREGROUND_BLUR,
 * BACKGROUND_BLUR. Only the shadow variants map onto a single CSS
 * `box-shadow` value; blurs translate to `filter:` and `backdrop-filter:`
 * and are emitted inline by the JSX side. So this module focuses on
 * shadow tokens.
 *
 * Each unique stack of shadows (the full `effects` array of one node
 * filtered to visible shadows) becomes one token. Two nodes carrying
 * "drop-shadow 0 4 12 black 12%" → same token. A node with two stacked
 * shadows produces a single token whose `cssValue` carries the
 * comma-separated list — that matches CSS `box-shadow` semantics.
 *
 * Token ids count up (`shadow-1`, `shadow-2`, ...) because shadow
 * stacks rarely have stable Figma names in raw exports — even when
 * Figma does name effect-styles, none surface in this fixture.
 */
import type { FigEffect, FigNode } from "@higma-document-models/fig/types";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { kiwiEnumName } from "@higma-document-models/fig/constants";
import type { ShadowToken } from "./types";
import { figColorToCss } from "../lib/css-format/color";
import { formatPx } from "../lib/css-format/numeric";

export type ShadowTokenTable = {
  readonly tokens: ReadonlyMap<string, ShadowToken>;
  readonly idByKey: ReadonlyMap<string, string>;
};

function effectTypeName(effect: FigEffect): string | undefined {
  return kiwiEnumName(effect.type, "FigEffect.type");
}

/** Convert one shadow effect to a single CSS box-shadow segment. */
function shadowToCss(effect: FigEffect): string | undefined {
  const type = effectTypeName(effect);
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

/**
 * Collapse a node's `effects` array into a single CSS `box-shadow`
 * value, or undefined when nothing is shadow-shaped. Order matches the
 * Figma stack order — Figma's first effect is the topmost shadow,
 * which CSS box-shadow paints first.
 */
export function effectsToBoxShadow(effects: readonly FigEffect[] | undefined): string | undefined {
  if (!effects || effects.length === 0) {
    return undefined;
  }
  const segments = effects
    .map(shadowToCss)
    .filter((s): s is string => s !== undefined);
  if (segments.length === 0) {
    return undefined;
  }
  return segments.join(", ");
}

/** Walk the targeted subtrees and collect shadow tokens. */
export function buildShadowTokens(
  usageNodes: readonly FigNode[],
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): ShadowTokenTable {
  const tokens = new Map<string, ShadowToken>();
  const idByKey = new Map<string, string>();
  for (const node of usageNodes) {
    visit(node, tokens, idByKey, childrenOf);
  }
  return { tokens, idByKey };
}

function visit(
  node: FigNode,
  tokens: Map<string, ShadowToken>,
  idByKey: Map<string, string>,
  childrenOf: FigKiwiDocumentIndex["childrenOf"],
): void {
  const cssValue = effectsToBoxShadow(node.effects);
  if (cssValue && !idByKey.has(cssValue)) {
    const id = `shadow-${tokens.size + 1}`;
    tokens.set(id, { id, source: "usage", cssValue });
    idByKey.set(cssValue, id);
  }
  for (const child of childrenOf(node)) {
    visit(child, tokens, idByKey, childrenOf);
  }
}

/** Resolve an effects array to its shadow-token id, when one exists. */
export function lookupShadowId(table: ShadowTokenTable, effects: readonly FigEffect[] | undefined): string | undefined {
  const cssValue = effectsToBoxShadow(effects);
  if (!cssValue) {
    return undefined;
  }
  return table.idByKey.get(cssValue);
}
