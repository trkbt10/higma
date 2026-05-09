/** @file Font cache tests. */

import type { FontQuery } from "./query";
import type { LoadedFont } from "./types";
import type { FontLoader } from "./loader";
import { createCachingFontLoader } from "./cache";

const INTER_QUERY: FontQuery = { family: "Inter", weight: 400, style: "normal" };

const LOADED_FONT: LoadedFont = {
  query: INTER_QUERY,
  font: {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    charToGlyph: () => ({ index: 1, advanceWidth: 500, getPath: () => ({ commands: [], toPathData: () => "" }) }),
    getPath: () => ({ commands: [], toPathData: () => "" }),
  },
};

function createLoader(): { readonly loader: FontLoader; readonly calls: { value: number } } {
  const calls = { value: 0 };
  const loader: FontLoader = {
    async loadFont(_query: FontQuery) {
      calls.value += 1;
      return LOADED_FONT;
    },
    async isFontAvailable() {
      return true;
    },
  };
  return { loader, calls };
}

describe("createCachingFontLoader", () => {
  it("caches explicitly requested primary fonts", async () => {
    const { loader, calls } = createLoader();
    const cachingLoader = createCachingFontLoader(loader);

    expect(cachingLoader.getCachedFont(INTER_QUERY)).toBeUndefined();

    await cachingLoader.loadFont(INTER_QUERY);
    await cachingLoader.loadFont(INTER_QUERY);

    expect(calls.value).toBe(1);
    expect(cachingLoader.getCachedFont(INTER_QUERY)).toBe(LOADED_FONT);
  });
});
