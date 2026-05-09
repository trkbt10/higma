/**
 * @file Font caching utilities.
 *
 * Cache keys come from the SoT `fontQueryKey`. Every cache and dedup site
 * in the codebase must use it — no ad-hoc separators or default-handling.
 */

import { fontQueryKey, type FontQuery } from "./query";
import type { FontLoader } from "./loader";
import type { LoadedFont } from "./types";

/** Font cache for loaded fonts. */
export type FontCache = {
  /** Get cached font. */
  get(query: FontQuery): LoadedFont | undefined;
  /** Set cached font. */
  set(query: FontQuery, font: LoadedFont): void;
  /** Check if font is cached. */
  has(query: FontQuery): boolean;
  /** Clear cache. */
  clear(): void;
  /** Get cache size. */
  readonly size: number;
};

/** Create a font cache. */
export function createFontCache(): FontCache {
  const cache = new Map<string, LoadedFont>();
  return {
    get(query) {
      return cache.get(fontQueryKey(query));
    },
    set(query, font) {
      cache.set(fontQueryKey(query), font);
    },
    has(query) {
      return cache.has(fontQueryKey(query));
    },
    clear() {
      cache.clear();
    },
    get size() {
      return cache.size;
    },
  };
}

/** Caching wrapper for font loaders. */
export type CachingFontLoader = FontLoader & {
  /** Read a loaded font without triggering I/O or permission prompts. */
  getCachedFont(query: FontQuery): LoadedFont | undefined;
  /** Clear the font cache. */
  clearCache(): void;
};

/** Create a caching wrapper for a font loader. */
export function createCachingFontLoader(innerLoader: FontLoader): CachingFontLoader {
  const fontCache = createFontCache();

  return {
    async loadFont(query) {
      const cached = fontCache.get(query);
      if (cached) {
        return cached;
      }
      const font = await innerLoader.loadFont(query);
      if (font) {
        fontCache.set(query, font);
      }
      return font;
    },

    async isFontAvailable(family) {
      return innerLoader.isFontAvailable(family);
    },

    async listFontFamilies() {
      if (innerLoader.listFontFamilies) {
        return innerLoader.listFontFamilies();
      }
      return [];
    },

    getCachedFont(query) {
      return fontCache.get(query);
    },

    clearCache() {
      fontCache.clear();
    },
  };
}
