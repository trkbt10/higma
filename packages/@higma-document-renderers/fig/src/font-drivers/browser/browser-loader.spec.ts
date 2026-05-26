/**
 * @file Spec — browser font loader resolution and aliasing.
 *
 * The integration scenario this guards is the WebGL fig-editor opening
 * a TEXT node whose `fontName.family` is "SF Pro" on macOS. The
 * browser's `queryLocalFonts` reports SFNS.ttf under its `name` table
 * family ("System Font"); without the physical-alias chain, the
 * loader would surface `undefined` for every SF Pro request and the
 * preload + ascender pipeline would throw with
 * `font "SF Pro" ... is not available via the configured loader`.
 *
 * The tests pass an explicit globalThis-like host whose
 * `queryLocalFonts` method is backed by a per-test catalogue, so the
 * loader can be exercised without granting real Local Font Access
 * permission. The fixture fonts are produced by `synthesizeFontBytes`
 * so opentype.js actually parses them and we get a real `LoadedFont`
 * back.
 */

// @vitest-environment node

import { Font, Glyph, Path } from "opentype.js";
import {
  createBrowserFontLoader,
  isBrowserFontLoaderSupported,
  type BrowserFontLoaderGlobalThisHost,
} from "./browser-loader";

// =============================================================================
// Local test font synthesiser
// =============================================================================
//
// The Node driver ships a richer `synthesizeFontBytes` co-located with
// its own spec; the browser driver lives in a separate directory and
// the package-wide lint rule routes cross-directory imports through
// `index.ts`. Re-exporting a test routine through `font-drivers/node`'s
// public API would force production consumers to step over a test-only
// symbol, so we inline a minimal font builder here. The only methods
// the loader consults on the returned bytes are opentype.js's parse
// surface (`unitsPerEm` / glyph paths); two glyphs are sufficient.
function synthesizeFontBytes(params: {
  readonly familyName: string;
  readonly styleName: string;
}): Uint8Array {
  const notdef = new Glyph({ name: ".notdef", unicode: 0, advanceWidth: 650, path: new Path() });
  const space = new Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new Path() });
  const aPath = new Path();
  aPath.moveTo(0, 0);
  aPath.lineTo(300, 0);
  aPath.lineTo(150, 600);
  aPath.close();
  const a = new Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: aPath });
  const font = new Font({
    familyName: params.familyName,
    styleName: params.styleName,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, space, a],
  });
  return new Uint8Array(font.toArrayBuffer());
}

type FakeFontData = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  blob(): Promise<Blob>;
};

const catalogueState: { value: readonly FakeFontData[] } = { value: [] };

const fontLoaderHost: BrowserFontLoaderGlobalThisHost = {
  queryLocalFonts: async () => catalogueState.value.slice(),
};

beforeEach(() => {
  catalogueState.value = [];
});

function installCatalogue(catalogue: readonly FakeFontData[]): void {
  catalogueState.value = catalogue;
}

function createTestBrowserFontLoader(platform: "darwin" | "linux" | "win32" | "unknown") {
  return createBrowserFontLoader({ host: fontLoaderHost, platform });
}

function fakeFont(params: {
  readonly family: string;
  readonly style: string;
  readonly fullName?: string;
  readonly postscriptName?: string;
  readonly onBlob?: () => void;
}): FakeFontData {
  const bytes = synthesizeFontBytes({ familyName: params.family, styleName: params.style });
  return {
    family: params.family,
    fullName: params.fullName ?? `${params.family} ${params.style}`,
    postscriptName: params.postscriptName ?? `${params.family.replace(/\s+/g, "")}-${params.style}`,
    style: params.style,
    async blob(): Promise<Blob> {
      params.onBlob?.();
      // `arrayBuffer()` is the only method the loader consumes — we
      // expose the synthesised bytes directly rather than constructing
      // a real `Blob` (which jsdom would have to provide).
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return {
        async arrayBuffer(): Promise<ArrayBuffer> {
          return arrayBuffer;
        },
      } as Blob;
    },
  };
}

describe("isBrowserFontLoaderSupported — explicit globalThis host", () => {
  it("reads Local Font Access support from the passed host", () => {
    expect(isBrowserFontLoaderSupported(fontLoaderHost)).toBe(true);
    expect(isBrowserFontLoaderSupported({})).toBe(false);
  });

  it("rejects loader construction when the explicit host has no Local Font Access API", () => {
    expect(() => createBrowserFontLoader({ host: {}, platform: "unknown" }))
      .toThrow("Browser font loader requires host.queryLocalFonts");
  });
});

describe("createBrowserFontLoader — direct resolution (platform-agnostic surface)", () => {
  it("returns the matching face when the requested family is in the catalogue", async () => {
    installCatalogue([
      fakeFont({ family: "Inter", style: "Regular" }),
      fakeFont({ family: "Inter", style: "Bold" }),
    ]);
    // Inter is not aliased on any platform; this test exercises the
    // raw direct-match path. Explicit platform: "unknown" makes the
    // intent obvious — no alias chain participation expected.
    const loader = createTestBrowserFontLoader("unknown");

    const result = await loader.loadFont({ family: "Inter", weight: 700, style: "normal" });
    expect(result).toBeDefined();
    expect(result?.query.family).toBe("Inter");
    expect(result?.query.weight).toBe(700);
  });

  it("returns undefined for an unmapped family the catalogue does not contain", async () => {
    // Fail-fast: a missing family must not silently substitute an
    // unrelated face. The renderer's text path treats `undefined` as
    // a hard error, which is the desired loud signal.
    installCatalogue([fakeFont({ family: "Inter", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("unknown");

    const result = await loader.loadFont({ family: "Cursed Type", weight: 400, style: "normal" });
    expect(result).toBeUndefined();
  });

  it("exposes the bound platform on the returned instance for diagnostics", async () => {
    installCatalogue([]);
    expect(createTestBrowserFontLoader("darwin").platform).toBe("darwin");
    expect(createTestBrowserFontLoader("linux").platform).toBe("linux");
    expect(createTestBrowserFontLoader("win32").platform).toBe("win32");
    expect(createTestBrowserFontLoader("unknown").platform).toBe("unknown");
  });
});

describe("createBrowserFontLoader — physical alias resolution (darwin only)", () => {
  it("[darwin] resolves 'SF Pro' through the 'System Font' name-table entry that macOS exposes", async () => {
    // This is the exact failure mode the user reported: a TEXT node
    // whose `fontName.family` is "SF Pro" sat on top of a browser
    // catalogue that only knew the font under its `name` table family
    // "System Font" (because that is what SFNS.ttf records). Without
    // the alias chain, `loadFont` returns undefined → preload throws
    // → resolveTextAscenderRatio throws → editing the text crashes.
    installCatalogue([
      fakeFont({ family: "System Font", style: "Regular" }),
      fakeFont({ family: "System Font", style: "Bold" }),
    ]);
    const loader = createTestBrowserFontLoader("darwin");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeDefined();
    // The matched face's `query.family` reflects the catalogue entry
    // ("System Font") because the SoT is "same physical file under an
    // alternate name", not "rename the loaded font on the way out".
    // Downstream caches still key on the *requested* family via
    // `fontQueryKey(query)` so subsequent SF Pro requests hit the
    // cache without re-walking the alias chain.
    expect(result?.query.family).toBe("System Font");
  });

  it("[darwin] resolves 'SF Pro Display' through the same alias chain", async () => {
    installCatalogue([fakeFont({ family: "System Font", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("darwin");

    const result = await loader.loadFont({ family: "SF Pro Display", weight: 400, style: "normal" });
    expect(result).toBeDefined();
  });

  it("[darwin] prefers a directly-installed 'SF Pro' bundle over the System Font alias", async () => {
    // If a user installs Apple's downloadable SF Pro otf bundle, it
    // appears in the catalogue under family "SF Pro" alongside the
    // OS's SFNS.ttf under "System Font". The chain's preferred-order
    // semantics demand we pick the direct entry; otherwise the
    // user-installed bundle would never be reached.
    installCatalogue([
      fakeFont({ family: "SF Pro", style: "Regular", postscriptName: "SFPro-Regular" }),
      fakeFont({ family: "System Font", style: "Regular", postscriptName: ".SFNS-Regular" }),
    ]);
    const loader = createTestBrowserFontLoader("darwin");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeDefined();
    expect(result?.postscriptName).toBe("SFPro-Regular");
  });

  it("[darwin] reports SF Pro available when only the System Font name-table entry is indexed", async () => {
    // `isFontAvailable` participates in the same alias chain so
    // callers that ask "do we have SF Pro?" before constructing a
    // FontQuery don't get a misleading `false` on macOS.
    installCatalogue([fakeFont({ family: "System Font", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("darwin");

    expect(await loader.isFontAvailable("SF Pro")).toBe(true);
  });
});

describe("createBrowserFontLoader — per-platform fail-fast", () => {
  // The "SF Pro" ↔ "System Font" alias is darwin-specific. A loader
  // bound to a different platform must NOT route SF Pro through
  // System Font — neither at the request layer nor at the
  // isFontAvailable surface. This guards against a flat alias map
  // regression that would leak darwin behaviour onto other hosts.

  it("[linux] 'SF Pro' returns undefined even when a 'System Font' face exists in the catalogue", async () => {
    // Regression: a host that happened to have a font registered
    // under "System Font" (e.g. a user-installed clone) must NOT
    // silently satisfy an SF Pro request on Linux.
    installCatalogue([
      fakeFont({ family: "System Font", style: "Regular" }),
      fakeFont({ family: "Inter", style: "Regular" }),
    ]);
    const loader = createTestBrowserFontLoader("linux");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeUndefined();
  });

  it("[linux] isFontAvailable('SF Pro') is false even when 'System Font' is indexed", async () => {
    installCatalogue([fakeFont({ family: "System Font", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("linux");

    expect(await loader.isFontAvailable("SF Pro")).toBe(false);
  });

  it("[win32] 'SF Pro' does NOT route to 'Segoe UI' even when Segoe UI is the only system-like family available", async () => {
    // Critical: Segoe UI is the Windows platform system font;
    // tempting but wrong as an alias for SF Pro (different typefaces,
    // not different names for one file).
    installCatalogue([
      fakeFont({ family: "Segoe UI", style: "Regular" }),
      fakeFont({ family: "Arial", style: "Regular" }),
    ]);
    const loader = createTestBrowserFontLoader("win32");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeUndefined();
  });

  it("[win32] 'SF Pro' returns undefined even when 'System Font' happens to be indexed", async () => {
    // Same shape as the linux test — different platform, same
    // contract: the macOS alias must not bleed into Windows.
    installCatalogue([fakeFont({ family: "System Font", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("win32");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeUndefined();
  });

  it("[unknown] platform behaves like linux/win32 — no alias chain participation", async () => {
    // Defensive: when the test runner / sandbox cannot expose a
    // userAgent at all, the loader defaults to `unknown` and must
    // not assume any platform-specific alias chain. The "unknown"
    // bucket is the safe default for unaudited hosts.
    installCatalogue([fakeFont({ family: "System Font", style: "Regular" })]);
    const loader = createTestBrowserFontLoader("unknown");

    const result = await loader.loadFont({ family: "SF Pro", weight: 400, style: "normal" });
    expect(result).toBeUndefined();
  });
});

describe("createBrowserFontLoader — variant selection priority", () => {
  it("picks the closest weight match within the resolved family", async () => {
    installCatalogue([
      fakeFont({ family: "Inter", style: "Regular", postscriptName: "Inter-Regular" }),
      fakeFont({ family: "Inter", style: "Bold", postscriptName: "Inter-Bold" }),
      fakeFont({ family: "Inter", style: "Medium", postscriptName: "Inter-Medium" }),
    ]);
    const loader = createTestBrowserFontLoader("unknown");

    // Weight 600 sits halfway between Medium (500) and Bold (700);
    // the sort is `|requested - actual|` and Medium / Bold tie at
    // distance 100. `figmaFontToQuery` produces deterministic weights
    // here so a tied comparison falls back to the array's stable
    // sort. Picking either is acceptable, but `loadFont` must return
    // one of the same-family faces — never silently choose a
    // different family for a Inter request.
    const result = await loader.loadFont({ family: "Inter", weight: 600, style: "normal" });
    expect(result).toBeDefined();
    expect(["Inter-Medium", "Inter-Bold"]).toContain(result?.postscriptName);
  });

  it("prefers a matching style over a closer weight", async () => {
    installCatalogue([
      fakeFont({ family: "Inter", style: "Regular", postscriptName: "Inter-Regular" }),
      fakeFont({ family: "Inter", style: "Italic", postscriptName: "Inter-Italic" }),
      fakeFont({ family: "Inter", style: "Bold Italic", postscriptName: "Inter-BoldItalic" }),
    ]);
    const loader = createTestBrowserFontLoader("unknown");

    // Italic + 400 should reach Inter-Italic (style match, weight 0
    // delta) over Inter-Regular (style miss, weight 0 delta) or
    // Inter-BoldItalic (style match, weight 300 delta).
    const result = await loader.loadFont({ family: "Inter", weight: 400, style: "italic" });
    expect(result?.postscriptName).toBe("Inter-Italic");
  });

  it("parses the selected physical browser font once across multiple query weights", async () => {
    const blobCalls = { value: 0 };
    installCatalogue([
      fakeFont({
        family: "Inter",
        style: "Regular",
        postscriptName: "Inter-Regular",
        onBlob: () => {
          blobCalls.value += 1;
        },
      }),
    ]);
    const loader = createTestBrowserFontLoader("unknown");

    await loader.loadFont({ family: "Inter", weight: 400, style: "normal" });
    await loader.loadFont({ family: "Inter", weight: 500, style: "normal" });
    await loader.loadFont({ family: "Inter", weight: 700, style: "normal" });

    expect(blobCalls.value).toBe(1);
  });
});
