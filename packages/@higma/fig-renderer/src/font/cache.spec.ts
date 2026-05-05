/** @file Font cache tests. */

import type { FontLoadOptions, LoadedFont } from "./types";
import type { FontLoader } from "./loader";
import { createCachingFontLoader } from "./cache";

const LOADED_FONT: LoadedFont = {
  family: "Inter",
  weight: 400,
  style: "normal",
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
    async loadFont(_options: FontLoadOptions) {
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
    const options: FontLoadOptions = { family: "Inter", weight: 400, style: "normal" };

    expect(cachingLoader.getCachedFont(options)).toBeUndefined();

    await cachingLoader.loadFont(options);
    await cachingLoader.loadFont(options);

    expect(calls.value).toBe(1);
    expect(cachingLoader.getCachedFont(options)).toBe(LOADED_FONT);
  });
});
