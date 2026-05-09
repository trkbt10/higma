/**
 * @file Spec — `preloadFonts` against an in-memory FontLoader.
 */
import { preloadFonts } from "./preload-fonts";
import { fontQueryKey, type FontQuery } from "../query";
import type { FontLoader } from "../loader";
import type { AbstractFont, LoadedFont } from "../types";

function fakeFont(query: FontQuery): LoadedFont {
  const dummyFont: AbstractFont = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    charToGlyph: () => ({ index: 1, getPath: () => ({ commands: [], toPathData: () => "" }) }),
    getPath: () => ({ commands: [], toPathData: () => "" }),
  };
  return { font: dummyFont, query };
}

function loaderWithFamilies(families: ReadonlySet<string>): FontLoader {
  return {
    async loadFont(query) {
      if (!families.has(query.family)) {
        return undefined;
      }
      return fakeFont(query);
    },
    async isFontAvailable(family) {
      return families.has(family);
    },
  };
}

describe("preloadFonts", () => {
  it("loads each query once and keys cache by fontQueryKey", async () => {
    const loader = loaderWithFamilies(new Set(["Inter"]));
    const queries: FontQuery[] = [
      { family: "Inter", weight: 400, style: "normal" },
      { family: "Inter", weight: 700, style: "normal" },
    ];
    const result = await preloadFonts({ queries, loader });
    expect(result.cache.size).toBe(2);
    expect(result.cache.has(fontQueryKey(queries[0]))).toBe(true);
    expect(result.cache.has(fontQueryKey(queries[1]))).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.substituted).toEqual([]);
  });

  it("throws on missing query when no fallback is configured", async () => {
    const loader = loaderWithFamilies(new Set(["Inter"]));
    const queries: FontQuery[] = [{ family: "Mystery", weight: 400, style: "normal" }];
    await expect(preloadFonts({ queries, loader })).rejects.toThrow(/Mystery/);
  });

  it("substitutes via fallback chain when caller opts in", async () => {
    const loader = loaderWithFamilies(new Set(["Inter"]));
    const queries: FontQuery[] = [{ family: "Mystery", weight: 400, style: "normal" }];
    const fallbacks: FontQuery[] = [
      { family: "Bogus", weight: 400, style: "normal" },
      { family: "Inter", weight: 400, style: "normal" },
    ];
    const result = await preloadFonts({ queries, loader, fallbacks });
    expect(result.cache.size).toBe(1);
    expect(result.missing.length).toBe(1);
    expect(result.substituted.length).toBe(1);
    expect(result.substituted[0].requested.family).toBe("Mystery");
    expect(result.substituted[0].used.family).toBe("Inter");
  });

  it("tolerateMissing skips unresolvable queries quietly", async () => {
    const loader = loaderWithFamilies(new Set([]));
    const queries: FontQuery[] = [{ family: "Mystery", weight: 400, style: "normal" }];
    const result = await preloadFonts({ queries, loader, tolerateMissing: true });
    expect(result.cache.size).toBe(0);
    expect(result.missing.length).toBe(1);
  });
});
