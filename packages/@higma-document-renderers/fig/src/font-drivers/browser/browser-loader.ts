/**
 * @file Browser font loader implementation using Local Font Access API
 *
 * Uses the Local Font Access API to enumerate and load system fonts.
 * Uses CSS Font Loading API for availability checks when Local Font Access is unavailable.
 *
 * Weight/style detection delegates to the canonical SoT (`figmaFontToQuery`)
 * — see node-loader for the same contract.
 *
 * @see https://developer.chrome.com/docs/capabilities/web-apis/local-fonts
 */

import { parse as parseFont } from "opentype.js";
import type { FontLoader } from "../../font/loader";
import type { FontQuery } from "../../font/query";
import { figmaFontToQuery } from "../../font/query";
import type { AbstractFont, LoadedFont } from "../../font/types";

/**
 * Parse font data and return as AbstractFont.
 *
 * opentype.js' `Font` class is structurally a superset of `AbstractFont`
 * (it exposes `unitsPerEm`, `ascender`, `descender`, `charToGlyph`,
 * `getPath`, and optional `tables` with the same shapes). We narrow via
 * a runtime-checked mapping to the minimal `AbstractFont` surface — no
 * casts — so the compatibility contract is verified per field instead
 * of being asserted with `as`.
 */
function parseOpentypeAsAbstractFont(data: ArrayBuffer): AbstractFont {
  const font = parseFont(data);
  const wrapped: AbstractFont = {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    charToGlyph(char: string) {
      const g = font.charToGlyph(char);
      return {
        index: g.index,
        advanceWidth: g.advanceWidth,
        getPath(x: number, y: number, fontSize: number) {
          const path = g.getPath(x, y, fontSize);
          return {
            commands: path.commands,
            // opentype.js requires an explicit decimal-place count; the
            // AbstractFont contract makes it optional. Default to 4 so
            // callers that omit the arg match opentype.js' built-in
            // precision for hinted outlines.
            toPathData(decimalPlaces?: number) {
              return path.toPathData(decimalPlaces ?? 4);
            },
          };
        },
      };
    },
    getPath(text: string, x: number, y: number, fontSize: number, options?: { letterSpacing?: number }) {
      const path = font.getPath(text, x, y, fontSize, options);
      return {
        commands: path.commands,
        toPathData(decimalPlaces?: number) {
          return path.toPathData(decimalPlaces ?? 4);
        },
      };
    },
    tables: font.tables,
  };
  return wrapped;
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

type WindowWithLocalFonts = Window & {
  queryLocalFonts: (options?: { postscriptNames?: string[] }) => Promise<FontData[]>;
};

function isLoadableFontData(font: { readonly family: string; readonly fullName: string; readonly postscriptName: string; readonly style: string }): font is FontData {
  return "blob" in font && typeof font.blob === "function";
}

function weightDistance(requested: number, actual: number): number {
  return Math.abs(requested - actual);
}

/**
 * Check if Local Font Access API is available.
 */
export function isBrowserFontLoaderSupported(): boolean {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

/**
 * Type guard: narrow `window` to `WindowWithLocalFonts`. The Local Font
 * Access API isn't part of the standard DOM lib types, so we attach the
 * extension signature via a structural narrowing instead of an `as`
 * cast at every call site.
 */
function hasLocalFontsApi(w: Window): w is WindowWithLocalFonts {
  return "queryLocalFonts" in w;
}

/** Browser font loader with permission tracking */
export type BrowserFontLoaderInstance = FontLoader & {
  /** Check if permission has been granted */
  hasPermission(): boolean;
  /** List available font families */
  listFontFamilies(): Promise<readonly string[]>;
};

/**
 * Create a browser font loader using Local Font Access API
 *
 * Requires user permission to access local fonts. The browser will
 * prompt the user when queryLocalFonts() is first called.
 */
export function createBrowserFontLoader(): BrowserFontLoaderInstance {
  const fontIndexRef = { value: null as Map<string, FontData[]> | null };
  const indexPromiseRef = { value: null as Promise<void> | null };
  const permissionGrantedRef = { value: false };

  async function buildFontIndex(): Promise<void> {
    if (typeof window === "undefined" || !hasLocalFontsApi(window)) {
      fontIndexRef.value = new Map();
      return;
    }

    const fonts = await window.queryLocalFonts();
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
    const familyLower = query.family.toLowerCase();
    const variants = index.get(familyLower);

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

    const blob = await bestMatch.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const font = parseOpentypeAsAbstractFont(arrayBuffer);
    const matchedQuery = figmaFontToQuery({ family: bestMatch.family, style: bestMatch.style });

    return {
      font,
      query: matchedQuery,
      postscriptName: bestMatch.postscriptName,
    };
  }

  async function isFontAvailable(family: string): Promise<boolean> {
    const index = await ensureIndex();
    if (index.has(family.toLowerCase())) {
      return true;
    }

    if (typeof document !== "undefined" && document.fonts) {
      return document.fonts.check(`16px "${family}"`);
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
  };
}
