/**
 * @file Spec — per-environment `getPhysicalFamilyAliases` contract.
 *
 * Locks the unit of font resolution as (family, platform):
 *
 *   - darwin: SFNS.ttf ↔ "System Font" carries the marketing labels
 *     "SF Pro" / "SF Pro Display" / "SF Pro Text". A request for
 *     any of those must end at "System Font" so the macOS Chromium
 *     `queryLocalFonts` catalogue (which reports the file under
 *     its `name` table family) is reachable. "SF Pro Rounded" is
 *     a separate physical file (SFNSRounded.ttf, name-table family
 *     ".SF NS Rounded") and routes through that key — explicitly
 *     never through "System Font" (which would swap rounded glyphs
 *     for square ones).
 *
 *   - linux / win32 / unknown: no aliases registered. A request
 *     for "SF Pro" on these platforms returns a single-element
 *     chain (the request itself); the loader looks it up directly
 *     and fails fast when the catalogue doesn't carry it. This is
 *     the contract that prevents silent substitution of "Segoe UI"
 *     or any other host-specific system font for a `.fig` authored
 *     against macOS-marketing-named SF Pro.
 *
 *   - Case-insensitive lookup, canonical-cased output: design
 *     documents may carry mixed-case spellings; browsers lowercase
 *     catalogue entries before indexing. The SoT bridges both
 *     conventions while keeping a deterministic canonical spelling
 *     for diagnostics.
 *
 *   - Lookups never invent fallbacks: an unmapped (family, platform)
 *     pair returns a one-element chain containing the requested name.
 */

import {
  detectBrowserFontPlatform,
  fontPlatformFromNodePlatform,
  getPhysicalFamilyAliases,
  physicalFamilyAliasesFor,
  type FontPlatform,
} from "./physical-aliases";

describe("getPhysicalFamilyAliases — darwin", () => {
  it("maps SF Pro to the macOS name-table family ('System Font')", () => {
    expect(getPhysicalFamilyAliases("SF Pro", "darwin")).toEqual(["SF Pro", "System Font"]);
  });

  it("maps SF Pro Display / Text through SF Pro to System Font", () => {
    expect(getPhysicalFamilyAliases("SF Pro Display", "darwin")).toEqual([
      "SF Pro Display",
      "SF Pro",
      "System Font",
    ]);
    expect(getPhysicalFamilyAliases("SF Pro Text", "darwin")).toEqual([
      "SF Pro Text",
      "SF Pro",
      "System Font",
    ]);
  });

  it("reverses 'System Font' back to the marketing name when tools store the name-table label", () => {
    expect(getPhysicalFamilyAliases("System Font", "darwin")).toEqual(["System Font", "SF Pro"]);
  });

  it("routes 'SF Pro Rounded' through '.SF NS Rounded' (same file, marketing label vs name-table family)", () => {
    expect(getPhysicalFamilyAliases("SF Pro Rounded", "darwin")).toEqual([
      "SF Pro Rounded",
      ".SF NS Rounded",
    ]);
  });

  it("never routes 'SF Pro Rounded' through 'System Font' (square-glyph SFNS.ttf — wrong physical file)", () => {
    const chain = getPhysicalFamilyAliases("SF Pro Rounded", "darwin");
    expect(chain).not.toContain("System Font");
  });

  it("reverses '.SF NS Rounded' to the marketing name (catalogue carries the name-table key)", () => {
    expect(getPhysicalFamilyAliases(".SF NS Rounded", "darwin")).toEqual([
      ".SF NS Rounded",
      "SF Pro Rounded",
    ]);
  });

  it("looks up case-insensitively but preserves canonical spelling in the chain", () => {
    expect(getPhysicalFamilyAliases("sf pro", "darwin")).toEqual(["SF Pro", "System Font"]);
    expect(getPhysicalFamilyAliases("SF PRO", "darwin")).toEqual(["SF Pro", "System Font"]);
    expect(getPhysicalFamilyAliases("system font", "darwin")).toEqual(["System Font", "SF Pro"]);
  });

  it("returns a single-element chain for unmapped families (no invented fallbacks)", () => {
    expect(getPhysicalFamilyAliases("Inter", "darwin")).toEqual(["Inter"]);
    expect(getPhysicalFamilyAliases("Helvetica Neue", "darwin")).toEqual(["Helvetica Neue"]);
  });

  it("each darwin chain's first entry equals the canonical-cased key (round-trip invariant)", () => {
    for (const [key, chain] of physicalFamilyAliasesFor("darwin")) {
      expect(chain[0]).toBe(key);
    }
  });
});

describe("getPhysicalFamilyAliases — linux / win32 / unknown fail-fast", () => {
  const platforms: readonly FontPlatform[] = ["linux", "win32", "unknown"];

  it("returns a single-element chain for 'SF Pro' on every non-darwin platform", () => {
    // No host on Linux / Windows / unknown environments ships
    // SFNS.ttf under either name; the loader must surface
    // "missing font" loudly rather than walk a darwin chain that
    // does not apply.
    for (const platform of platforms) {
      expect(getPhysicalFamilyAliases("SF Pro", platform)).toEqual(["SF Pro"]);
      expect(getPhysicalFamilyAliases("SF Pro Display", platform)).toEqual(["SF Pro Display"]);
      expect(getPhysicalFamilyAliases("System Font", platform)).toEqual(["System Font"]);
    }
  });

  it("registers NO aliases at all for non-darwin platforms (regression guard)", () => {
    // Any entry added here without [V]-grade evidence would be a
    // silent-substitution policy. The map must stay empty until a
    // concrete, verified divergence is documented.
    for (const platform of platforms) {
      expect(physicalFamilyAliasesFor(platform).size).toBe(0);
    }
  });
});

describe("getPhysicalFamilyAliases — environment forbids cross-platform leakage", () => {
  it("the darwin 'SF Pro' alias does not bleed into linux/win32 resolution", () => {
    // Critical regression: a stale flat map would leak macOS
    // aliases onto Linux / Windows loaders, where the resulting
    // "System Font" lookup might accidentally hit an unrelated
    // user-installed font of the same name. Per-platform keying
    // prevents that.
    const darwin = getPhysicalFamilyAliases("SF Pro", "darwin");
    const linux = getPhysicalFamilyAliases("SF Pro", "linux");
    const win32 = getPhysicalFamilyAliases("SF Pro", "win32");

    expect(darwin).toContain("System Font");
    expect(linux).not.toContain("System Font");
    expect(win32).not.toContain("System Font");
  });

  it("no chain on any platform emits a CSS keyword (loader-only contract — CSS belongs to COMMON_FONT_MAPPINGS)", () => {
    const forbiddenCssKeywords = new Set([
      "system-ui", "-apple-system", "BlinkMacSystemFont",
      "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
      "sans-serif", "serif", "monospace", "cursive", "fantasy",
    ]);
    for (const platform of ["darwin", "linux", "win32", "unknown"] as const) {
      for (const chain of physicalFamilyAliasesFor(platform).values()) {
        for (const entry of chain) {
          expect(forbiddenCssKeywords.has(entry)).toBe(false);
        }
      }
    }
  });

  it("only darwin carries dot-prefixed name-table identities (Apple-internal fonts); other platforms stay clean", () => {
    // Dot-prefixed names are legitimate on darwin — Apple ships
    // SFNSRounded.ttf with `name.fontFamily.en = ".SF NS Rounded"`.
    // The browser's `queryLocalFonts` and the on-disk loader index
    // BOTH key the file under that exact string, so the alias chain
    // must be allowed to mention it.
    // On linux / win32 / unknown there is no Apple-internal-name
    // convention; any dot-prefixed entry would be a typo or a
    // stray darwin entry that bled across platforms.
    for (const platform of ["linux", "win32", "unknown"] as const) {
      for (const chain of physicalFamilyAliasesFor(platform).values()) {
        for (const entry of chain) {
          expect(entry.startsWith(".")).toBe(false);
        }
      }
    }
  });
});

describe("fontPlatformFromNodePlatform — Node.js platform mapping", () => {
  it("maps the three covered platforms verbatim", () => {
    expect(fontPlatformFromNodePlatform("darwin")).toBe("darwin");
    expect(fontPlatformFromNodePlatform("linux")).toBe("linux");
    expect(fontPlatformFromNodePlatform("win32")).toBe("win32");
  });

  it("collapses unsupported / future platforms to 'unknown'", () => {
    // `process.platform` can be any of the Node-defined values
    // (freebsd, openbsd, sunos, aix, …). The SoT only carries
    // verified aliases for the three covered platforms; everything
    // else MUST land on `unknown` so the loader treats the
    // catalogue as authoritative.
    expect(fontPlatformFromNodePlatform("freebsd" as NodeJS.Platform)).toBe("unknown");
    expect(fontPlatformFromNodePlatform("openbsd" as NodeJS.Platform)).toBe("unknown");
    expect(fontPlatformFromNodePlatform("sunos" as NodeJS.Platform)).toBe("unknown");
    expect(fontPlatformFromNodePlatform("aix" as NodeJS.Platform)).toBe("unknown");
  });
});

describe("detectBrowserFontPlatform — userAgent sniffing", () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  function installNavigator(userAgent: string): void {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent },
    });
  }

  function restoreNavigator(): void {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      return;
    }
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
  }

  afterEach(() => {
    restoreNavigator();
  });

  it("returns 'unknown' when navigator is absent (Node, jsdom-less runner)", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });
    expect(detectBrowserFontPlatform()).toBe("unknown");
  });

  it("returns 'darwin' for representative Chromium Mac userAgents", () => {
    installNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    expect(detectBrowserFontPlatform()).toBe("darwin");
  });

  it("returns 'win32' for representative Chromium Windows userAgents", () => {
    installNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    expect(detectBrowserFontPlatform()).toBe("win32");
  });

  it("returns 'linux' for representative Chromium Linux userAgents", () => {
    installNavigator(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    expect(detectBrowserFontPlatform()).toBe("linux");
  });

  it("returns 'unknown' when the userAgent string is empty or unrecognised", () => {
    installNavigator("");
    expect(detectBrowserFontPlatform()).toBe("unknown");
    installNavigator("CustomSandboxed/1.0");
    expect(detectBrowserFontPlatform()).toBe("unknown");
  });
});
