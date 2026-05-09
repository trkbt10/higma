/**
 * @file Preload a set of `FontQuery` through a `FontLoader` and return
 * a synchronous lookup keyed by the canonical `fontQueryKey`.
 *
 * Single SoT for "preload these fonts before the renderer asks for
 * outlines synchronously". Anywhere else in the codebase that loops
 * over queries to call `loadFont` is duplicating this — and likely
 * also adding ad-hoc fallbacks (Roboto, Noto Sans JP, …) that hide
 * unavailable fonts. The fail-fast policy is: if a query fails to
 * load and no `fallback` is configured, throw with the offending
 * family. Callers that need a fallback must declare it explicitly.
 */

import { fontQueryKey, type FontQuery } from "../query";
import type { FontLoader } from "../loader";
import type { LoadedFont } from "../types";

export type PreloadFontsInput = {
  readonly queries: readonly FontQuery[];
  readonly loader: FontLoader;
  /**
   * Explicit, ordered fallback chain consulted only when a query's
   * direct load returns `undefined`. The first fallback that loads
   * successfully wins. When no fallback resolves, the original query's
   * unavailability propagates as a thrown error — the no-fallback
   * policy is preserved unless the caller opted in.
   */
  readonly fallbacks?: readonly FontQuery[];
  /**
   * When true, queries whose loader cannot satisfy them (and that no
   * fallback covers) are silently skipped instead of throwing. The
   * resulting cache simply omits them. Only used by call sites that
   * have to keep going on partial coverage (e.g. a contact-sheet
   * preflight) — never by the production rendering path.
   */
  readonly tolerateMissing?: boolean;
};

export type PreloadFontsResult = {
  /** Map keyed by `fontQueryKey(query)` of the loaded font for that query. */
  readonly cache: ReadonlyMap<string, LoadedFont>;
  /**
   * Queries whose direct load returned `undefined`. When `fallbacks`
   * resolved them, the resolved font is in `cache` and the query
   * still appears here so the caller can log substitution. When no
   * fallback resolved them and `tolerateMissing` is true, the query
   * is here and the cache entry is absent.
   */
  readonly missing: readonly FontQuery[];
  /**
   * Queries that resolved through the explicit fallback chain
   * (paired with the fallback actually used). Useful for logging
   * "FOO was substituted with BAR" without re-walking the loader.
   */
  readonly substituted: readonly { readonly requested: FontQuery; readonly used: FontQuery }[];
};

/**
 * Load every query through `loader` and return a `Map` keyed by the
 * canonical query key. The first entry that loads from the
 * `fallbacks` chain is reused for every otherwise-unresolvable
 * query — i.e. callers don't have to interleave per-query try /
 * catch.
 */
export async function preloadFonts(input: PreloadFontsInput): Promise<PreloadFontsResult> {
  const { queries, loader, fallbacks = [], tolerateMissing = false } = input;
  const cache = new Map<string, LoadedFont>();
  const missing: FontQuery[] = [];
  const substituted: { readonly requested: FontQuery; readonly used: FontQuery }[] = [];

  // Resolve fallback fonts up-front so the per-query loop is cheap.
  // A failed fallback is not fatal in itself — the caller chose the
  // chain — but if every fallback fails AND the caller opted out of
  // tolerateMissing AND a real query later needs to substitute, we
  // raise a clear error.
  const fallbackChain: { readonly query: FontQuery; readonly loaded: LoadedFont }[] = [];
  for (const fb of fallbacks) {
    const loaded = await loader.loadFont(fb);
    if (loaded !== undefined) {
      fallbackChain.push({ query: fb, loaded });
    }
  }

  for (const query of queries) {
    const key = fontQueryKey(query);
    if (cache.has(key)) {
      continue;
    }
    const direct = await loader.loadFont(query);
    if (direct !== undefined) {
      cache.set(key, direct);
      continue;
    }
    missing.push(query);
    if (fallbackChain.length === 0) {
      if (tolerateMissing) {
        continue;
      }
      throw new Error(
        `preloadFonts: font "${query.family}" (weight=${query.weight}, style=${query.style}) is not available via the configured loader, and no fallback was provided`,
      );
    }
    const fb = fallbackChain[0];
    cache.set(key, fb.loaded);
    substituted.push({ requested: query, used: fb.query });
  }

  return { cache, missing, substituted };
}
