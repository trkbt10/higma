/**
 * @file Resolver backed by an explicit loaded-font cache.
 *
 * Both sides speak the canonical `FontQuery` — no normalization happens
 * here. If the cache and resolver disagree on what "the same font" means,
 * fix `figmaFontToQuery` (the SoT), not this resolver.
 */

import type { FontQuery } from "@higma-document-models/fig/font";
import type { LoadedFont } from "@higma-document-models/fig/font";
import type { TextFontResolver } from "./types";

export type CachedTextFontSource = {
  readonly getCachedFont: (query: FontQuery) => LoadedFont | undefined;
};

/** Create a synchronous text outline resolver from an explicitly preloaded font cache. */
export function createCachedTextFontResolver(source: CachedTextFontSource): TextFontResolver {
  return (query) => source.getCachedFont(query)?.font;
}
