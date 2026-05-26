/**
 * @file Browser font loader implementation using Local Font Access API
 *
 * Uses an explicit Local Font Access API host to enumerate and load
 * system fonts.
 *
 * Weight/style detection delegates to the canonical SoT (`figmaFontToQuery`)
 * — see node-loader for the same contract.
 *
 * @see https://developer.chrome.com/docs/capabilities/web-apis/local-fonts
 */

import { parse as parseFont } from "opentype.js";
import type { FontLoader } from "@higma-document-models/fig/font";
import type { FontQuery } from "@higma-document-models/fig/font";
import {
  figmaFontToQuery,
  getPhysicalFamilyAliases,
  type FontPlatform,
  type BrowserFontPlatformDetectionHost,
} from "@higma-document-models/fig/font";
import type { AbstractFont, LoadedFont } from "@higma-document-models/fig/font";
import { getVariableAxes, variationForWeight, wrapFontWithVariation } from "../variable-font";

/**
 * Parse font data and return as the shared `AbstractFont` surface.
 *
 * Keep the original opentype.js Font object rather than wrapping it:
 * variable-font rendering needs the raw `variation` API and raw glyph
 * objects so the shared `wrapFontWithVariation` implementation can apply
 * the same `wght` / `opsz` axes in browser and node loaders.
 */
function parseOpentypeAsAbstractFont(data: ArrayBuffer): AbstractFont {
  return parseFont(data);
}

function applyVariationWrapping(
  rawFont: AbstractFont,
  variableAxes: ReturnType<typeof getVariableAxes>,
  weight: number,
): AbstractFont {
  if (!variableAxes) {
    return rawFont;
  }
  return wrapFontWithVariation(rawFont, variationForWeight(variableAxes, weight), variableAxes);
}

async function parseBrowserFontData(font: FontData): Promise<AbstractFont> {
  const blob = await font.blob();
  const arrayBuffer = await blob.arrayBuffer();
  return parseOpentypeAsAbstractFont(arrayBuffer);
}

/**
 * Type definitions for Local Font Access API
 */
type FontData = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  blob(): Promise<Blob>;
};

export type BrowserFontLoaderGlobalThisHost = BrowserFontPlatformDetectionHost &
  {
    readonly queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<FontData[]>;
  };

type BrowserFontLoaderLocalFontsHost = BrowserFontLoaderGlobalThisHost & {
  readonly queryLocalFonts: (options?: { postscriptNames?: string[] }) => Promise<FontData[]>;
};

function isLoadableFontData(font: { readonly family: string; readonly fullName: string; readonly postscriptName: string; readonly style: string }): font is FontData {
  return "blob" in font && typeof font.blob === "function";
}

function weightDistance(requested: number, actual: number): number {
  return Math.abs(requested - actual);
}

/**
 * Walk the physical-alias chain returned by
 * `getPhysicalFamilyAliases` and return the first non-empty bucket
 * present in `index`. The order of the chain encodes the
 * preferred-resolution policy (canonical name first, then the
 * alternate OS / name-table spellings of the same physical file);
 * we stop on the first hit so a request for "SF Pro" prefers an
 * "SF Pro" entry over its "System Font" alias when both happen to
 * be indexed (e.g. user-installed copy alongside SFNS.ttf).
 */
function findVariantsThroughAliases(
  index: Map<string, FontData[]>,
  aliasChain: readonly string[],
): FontData[] | undefined {
  for (const alias of aliasChain) {
    const variants = index.get(alias.toLowerCase());
    if (variants && variants.length > 0) {
      return variants;
    }
  }
  return undefined;
}

/**
 * Check if Local Font Access API is available.
 */
export function isBrowserFontLoaderSupported(host: BrowserFontLoaderGlobalThisHost): boolean {
  return hasLocalFontsApi(host);
}

/**
 * Type guard: narrow an explicit JavaScript global object to the
 * Local Font Access API surface. The API isn't part of every DOM lib
 * type, so we attach the extension signature via structural
 * narrowing.
 */
function hasLocalFontsApi(host: BrowserFontLoaderGlobalThisHost): host is BrowserFontLoaderLocalFontsHost {
  return typeof host.queryLocalFonts === "function";
}

function requireLocalFontsHost(host: BrowserFontLoaderGlobalThisHost): BrowserFontLoaderLocalFontsHost {
  if (!hasLocalFontsApi(host)) {
    throw new Error("Browser font loader requires host.queryLocalFonts");
  }
  return host;
}

/** Browser font loader with permission tracking */
export type BrowserFontLoaderInstance = FontLoader & {
  /** Check if permission has been granted */
  hasPermission(): boolean;
  /** List available font families */
  listFontFamilies(): Promise<readonly string[]>;
  /**
   * Platform the alias chain is bound to. Captured at loader
   * construction so a single loader instance never silently
   * switches resolution policy if `navigator.userAgent` is mutated
   * later. Exposed for diagnostics / spec assertions.
   */
  readonly platform: FontPlatform;
};

export type CreateBrowserFontLoaderOptions = {
  readonly host: BrowserFontLoaderGlobalThisHost;
  readonly platform: FontPlatform;
};

/**
 * Create a browser font loader using Local Font Access API.
 *
 * Requires user permission to access local fonts. The browser will
 * prompt the user when `queryLocalFonts()` is first called.
 *
 * The loader binds the **environment-specific** physical-alias chain
 * at construction time. The browser's queryLocalFonts catalogue is
 * host-OS-specific (macOS reports SFNS.ttf under "System Font",
 * Linux/Windows do not), and the caller must pass the matching
 * platform. Use `detectBrowserFontPlatform(globalThis)` at the ESM
 * composition boundary when the browser host is the source for that
 * decision.
 */
export function createBrowserFontLoader(
  options: CreateBrowserFontLoaderOptions,
): BrowserFontLoaderInstance {
  const { host, platform } = options;
  const localFontsHost = requireLocalFontsHost(host);
  const fontIndexRef = { value: null as Map<string, FontData[]> | null };
  const indexPromiseRef = { value: null as Promise<void> | null };
  const permissionGrantedRef = { value: false };
  const parsedFontRef = { value: new Map<string, AbstractFont>() };

  async function buildFontIndex(): Promise<void> {
    const fonts = await localFontsHost.queryLocalFonts();
    permissionGrantedRef.value = true;

    const index = new Map<string, FontData[]>();
    for (const font of fonts) {
      if (!isLoadableFontData(font)) {
        continue;
      }
      const familyLower = font.family.toLowerCase();
      const existing = index.get(familyLower) ?? [];
      index.set(familyLower, [...existing, font]);
    }

    fontIndexRef.value = index;
  }

  async function ensureIndex(): Promise<Map<string, FontData[]>> {
    if (fontIndexRef.value) {
      return fontIndexRef.value;
    }

    if (!indexPromiseRef.value) {
      indexPromiseRef.value = buildFontIndex();
    }

    await indexPromiseRef.value;
    return fontIndexRef.value!;
  }

  async function loadFont(query: FontQuery): Promise<LoadedFont | undefined> {
    const index = await ensureIndex();
    // Resolve the requested family through the platform-keyed
    // physical-aliases SoT before giving up. macOS reports SFNS.ttf
    // to `queryLocalFonts` under its `name` table family
    // ("System Font"); a Figma document that authors the same font
    // as "SF Pro" would otherwise miss the entry on every modern
    // Mac. On linux / win32 the SoT carries no SF Pro alias and the
    // chain collapses to `[query.family]` — the request fails fast
    // on hosts that legitimately do not ship SFNS.ttf.
    const aliasChain = getPhysicalFamilyAliases(query.family, platform);
    const variants = findVariantsThroughAliases(index, aliasChain);

    if (!variants || variants.length === 0) {
      return undefined;
    }

    // Closest-match selection. Each variant's style string is run through
    // the same SoT translator the requester used, so comparisons happen
    // in a normalized space.
    const sorted = [...variants].sort((a, b) => {
      const aQuery = figmaFontToQuery({ family: a.family, style: a.style });
      const bQuery = figmaFontToQuery({ family: b.family, style: b.style });

      const aStyleMatch = aQuery.style === query.style ? 0 : 1;
      const bStyleMatch = bQuery.style === query.style ? 0 : 1;
      if (aStyleMatch !== bStyleMatch) {
        return aStyleMatch - bStyleMatch;
      }

      return weightDistance(query.weight, aQuery.weight) - weightDistance(query.weight, bQuery.weight);
    });

    const bestMatch = sorted[0];
    if (!bestMatch) {
      return undefined;
    }

    const rawFont = await loadParsedFont(bestMatch);
    const font = applyVariationWrapping(rawFont, getVariableAxes(rawFont), query.weight);
    const matchedQuery = figmaFontToQuery({ family: bestMatch.family, style: bestMatch.style });

    return {
      font,
      query: matchedQuery,
      postscriptName: bestMatch.postscriptName,
    };
  }

  async function loadParsedFont(font: FontData): Promise<AbstractFont> {
    const cached = parsedFontRef.value.get(font.postscriptName);
    if (cached !== undefined) {
      return cached;
    }
    const parsed = await parseBrowserFontData(font);
    parsedFontRef.value.set(font.postscriptName, parsed);
    return parsed;
  }

  async function isFontAvailable(family: string): Promise<boolean> {
    const index = await ensureIndex();
    // Check the requested name and any platform-specific physical
    // alias against the same Local Font Access catalogue used by
    // `loadFont`. CSS-only availability lives in the CSS font loader;
    // returning true here without loadable font bytes would hide a
    // text-metrics SoT failure.
    for (const alias of getPhysicalFamilyAliases(family, platform)) {
      if (index.has(alias.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  async function listFontFamilies(): Promise<readonly string[]> {
    const index = await ensureIndex();
    return Array.from(index.values()).map((variants) => variants[0].family);
  }

  return {
    loadFont,
    isFontAvailable,
    listFontFamilies,
    hasPermission(): boolean {
      return permissionGrantedRef.value;
    },
    platform,
  };
}
