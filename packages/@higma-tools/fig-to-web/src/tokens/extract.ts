/**
 * @file Build a complete `TokenSet` and the matching `TokenIndex` from
 * the fig source plus the actual subtrees the emitter will walk.
 *
 * The split between *what to walk for tokens* and *what to walk for
 * JSX* matters: tokens are extracted from style proxies on the
 * Internal Only Canvas plus the targeted frames, while JSX is emitted
 * from those targeted frames only. Restricting token scope to the
 * frames that will ship keeps the generated stylesheet relevant — no
 * stray colours from a hidden CANVAS the user did not select.
 */
import type { FigEffect, FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { FigSymbolContext } from "@higma-document-io/fig/context";
import { findInternalCanvas } from "@higma-document-io/fig/context";
import type { TokenIndex, TokenSet } from "./types";
import { buildColorTokens, lookupColorId } from "./color";
import { buildTypographyTokens, lookupTypographyId } from "./typography";
import { buildRadiusTokens, buildSpacingTokens, lookupRadiusId, lookupSpacingId } from "./spacing";
import { buildShadowTokens, lookupShadowId } from "./effect";

function styleFillProxies(source: FigSymbolContext): readonly FigNode[] {
  const internal = findInternalCanvas(source.tree.roots);
  if (!internal) {
    return [];
  }
  const out: FigNode[] = [];
  for (const child of internal.children ?? []) {
    if (!child) {
      continue;
    }
    if (child.styleType?.name === "FILL") {
      out.push(child);
    }
  }
  return out;
}

export type TokenBuildResult = {
  readonly tokens: TokenSet;
  readonly index: TokenIndex;
};

/**
 * Build the full TokenSet (and its lookup index) for the given fig
 * source restricted to the supplied target frames.
 */
export function buildTokensFromFrames(
  source: FigSymbolContext,
  frames: readonly FigNode[],
): TokenBuildResult {
  const proxies = styleFillProxies(source);

  const colorTable = buildColorTokens(proxies, frames);
  const typographyTable = buildTypographyTokens(frames);
  const spacingTable = buildSpacingTokens(frames);
  const radiusTable = buildRadiusTokens(frames);
  const shadowTable = buildShadowTokens(frames);

  const tokens: TokenSet = {
    colors: colorTable.tokens,
    typography: typographyTable.tokens,
    spacing: spacingTable.tokens,
    radii: radiusTable.tokens,
    shadows: shadowTable.tokens,
  };

  const index: TokenIndex = {
    colorIdForPaints: (paints) => resolvePaints(paints, (paint) => lookupColorId(colorTable, paint)),
    spacingIdFor: (value: number) => lookupSpacingId(spacingTable, value),
    radiusIdFor: (value: number) => lookupRadiusId(radiusTable, value),
    shadowIdFor: (effects: readonly FigEffect[] | undefined) => lookupShadowId(shadowTable, effects),
    typographyIdFor: (family, style, fontSize, lineHeight, letterSpacing) =>
      lookupTypographyId(typographyTable, family, style, fontSize, lineHeight, letterSpacing),
  };

  return { tokens, index };
}

/**
 * Resolve a paint array to a single colour-token id. We only collapse
 * a one-element array of a SOLID paint — multi-paint stacks (e.g.
 * gradient-over-solid) cannot be represented by one token, and for
 * those the JSX emitter falls back to inline values.
 */
function resolvePaints(
  paints: readonly FigPaint[] | undefined,
  resolver: (p: FigPaint) => string | undefined,
): string | undefined {
  if (!paints || paints.length !== 1) {
    return undefined;
  }
  const sole = paints[0];
  if (!sole) {
    return undefined;
  }
  return resolver(sole);
}
