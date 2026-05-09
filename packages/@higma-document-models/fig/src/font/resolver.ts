/**
 * @file Font resolver — resolves Figma fonts to CSS font stacks.
 *
 * Wraps `buildCssFontFamily` (the SoT for emitting CSS `font-family`
 * strings) with availability-checking and caching. Uses `figmaFontToQuery`
 * so weight/style detection matches every other consumer in the codebase.
 */

import type {
  FigmaFontRef,
  ResolvedFont,
  FontResolverConfig,
  FontAvailabilityChecker,
} from "./types";
import { figmaFontToQuery } from "./query";
import {
  COMMON_FONT_MAPPINGS,
  buildCssFontFamily,
  buildCssFontFamilyChain,
} from "./mappings";

type ResolvedFontResolverConfig = {
  readonly fontMappings: ReadonlyMap<string, readonly string[]>;
  readonly defaultFontStack: readonly string[];
  readonly availabilityChecker: FontAvailabilityChecker;
};

const DEFAULT_FONT_STACK: readonly string[] = [];

const DEFAULT_CONFIG = {
  fontMappings: COMMON_FONT_MAPPINGS,
};

/** Resolve an availability check that may be synchronous or async. */
async function resolveAvailability(result: boolean | Promise<boolean>): Promise<boolean> {
  if (typeof result === "boolean") {
    return result;
  }
  return result;
}

/** Font resolver instance. */
export type FontResolverInstance = {
  /** Resolve a Figma font reference to CSS font properties. */
  resolve(fontRef: FigmaFontRef): ResolvedFont;
  /** Resolve a Figma font reference asynchronously. */
  resolveAsync(fontRef: FigmaFontRef): Promise<ResolvedFont>;
  /** Clear the resolution cache. */
  clearCache(): void;
};

/** Resolve Figma font names to CSS font stacks. */
export function createFontResolver(config: FontResolverConfig): FontResolverInstance {
  const resolvedConfig: ResolvedFontResolverConfig = {
    fontMappings: config.fontMappings ?? DEFAULT_CONFIG.fontMappings,
    defaultFontStack: config.defaultFontStack ?? DEFAULT_FONT_STACK,
    availabilityChecker: config.availabilityChecker,
  };
  const cache = new Map<string, ResolvedFont>();

  function buildChain(family: string): readonly string[] {
    return buildCssFontFamilyChain(family, {
      customMappings: resolvedConfig.fontMappings,
      tailStack: resolvedConfig.defaultFontStack,
    });
  }

  function buildString(family: string): string {
    return buildCssFontFamily(family, {
      customMappings: resolvedConfig.fontMappings,
      tailStack: resolvedConfig.defaultFontStack,
    });
  }

  function checkAvailability(family: string): boolean {
    const result = resolvedConfig.availabilityChecker.isAvailable(family);
    if (typeof result === "boolean") {
      return result;
    }
    throw new Error(`Font resolver resolve() received async availability for ${family}; use resolveAsync()`);
  }

  function doResolve(fontRef: FigmaFontRef): ResolvedFont {
    // Defer (weight, style) detection to the canonical SoT.
    const query = figmaFontToQuery(fontRef);
    const fontFamilyChain = buildChain(query.family);
    const isExactMatch = checkAvailability(query.family);
    const fontFamily = buildString(query.family);
    return {
      fontFamily,
      fontWeight: query.weight,
      fontStyle: query.style,
      isExactMatch,
      source: fontRef,
      fontFamilyChain,
    };
  }

  return {
    resolve(fontRef: FigmaFontRef): ResolvedFont {
      const cacheKey = `${fontRef.family}|${fontRef.style}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const resolved = doResolve(fontRef);
      cache.set(cacheKey, resolved);
      return resolved;
    },

    async resolveAsync(fontRef: FigmaFontRef): Promise<ResolvedFont> {
      const query = figmaFontToQuery(fontRef);
      const fontFamilyChain = buildChain(query.family);
      if (!resolvedConfig.availabilityChecker) {
        throw new Error(`Font resolver requires an explicit availabilityChecker for ${query.family}`);
      }
      const availabilityResult = resolvedConfig.availabilityChecker.isAvailable(query.family);
      const isExactMatch = await resolveAvailability(availabilityResult);
      const fontFamily = buildString(query.family);
      return {
        fontFamily,
        fontWeight: query.weight,
        fontStyle: query.style,
        isExactMatch,
        source: fontRef,
        fontFamilyChain,
      };
    },

    clearCache(): void {
      cache.clear();
    },
  };
}

/** Browser font availability checker using CSS Font Loading API. */
export function createBrowserAvailabilityChecker(): FontAvailabilityChecker {
  return {
    isAvailable(family: string): boolean | Promise<boolean> {
      if (typeof document === "undefined" || !document.fonts) {
        throw new Error("Browser font availability requires document.fonts");
      }
      // Probe a representative ASCII range so the browser actually consults
      // a glyph table rather than returning "yes" on metric-only matches.
      const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      return document.fonts.check(`16px "${family}"`, testString);
    },
  };
}
