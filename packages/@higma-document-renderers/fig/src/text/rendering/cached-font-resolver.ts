/**
 * @file Adapter from an explicit loaded-font cache to text glyph resolution.
 *
 * Both sides speak the canonical `FontQuery` — no normalization happens
 * here. If the cache and resolver disagree on what "the same font" means,
 * fix `figmaFontToQuery` (the SoT), not this adapter.
 */

import type { FontQuery } from "../../font/query";
import type { LoadedFont } from "../../font/types";
import type { TextFontResolver } from "./types";

export type CachedTextFontSource = {
  readonly getCachedFont: (query: FontQuery) => LoadedFont | undefined;
};

/** Create a synchronous text outline resolver from an explicitly preloaded font cache. */
export function createCachedTextFontResolver(source: CachedTextFontSource): TextFontResolver {
  return (query) => source.getCachedFont(query)?.font;
}
