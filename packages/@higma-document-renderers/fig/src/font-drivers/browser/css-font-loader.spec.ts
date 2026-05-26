/**
 * @file Spec for the CSS Font Loading API backed font loader.
 */

import {
  createCssFontLoader,
  isCssFontLoaderSupported,
  type CssFontLoaderGlobalThisHost,
} from "./css-font-loader";

function supportedHost(calls: string[]): CssFontLoaderGlobalThisHost {
  return {
    document: {
      fonts: {
        check(font: string, text?: string): boolean {
          calls.push(`${font}|${text}`);
          return font === "16px \"Inter\"";
        },
      },
    },
  };
}

describe("isCssFontLoaderSupported", () => {
  it("reads CSS Font Loading support from the explicit host", () => {
    expect(isCssFontLoaderSupported(supportedHost([]))).toBe(true);
    expect(isCssFontLoaderSupported({})).toBe(false);
  });
});

describe("createCssFontLoader", () => {
  it("checks font availability through host.document.fonts", async () => {
    const calls: string[] = [];
    const loader = createCssFontLoader(supportedHost(calls));

    expect(await loader.isFontAvailable("Inter")).toBe(true);
    expect(calls).toEqual([
      "16px \"Inter\"|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    ]);
  });

  it("throws when the explicit host does not expose CSS Font Loading", () => {
    expect(() => createCssFontLoader({}))
      .toThrow("CSS font loader requires host.document.fonts");
  });

  it("does not claim it can load path-capable font files", async () => {
    const loader = createCssFontLoader(supportedHost([]));

    expect(await loader.loadFont({ family: "Inter", weight: 400, style: "normal" })).toBeUndefined();
    expect(loader.listFontFamilies).toBeDefined();
    expect(await loader.listFontFamilies?.()).toEqual([]);
  });
});
