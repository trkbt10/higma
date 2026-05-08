/**
 * @file Font resolver - resolves Figma fonts to CSS font stacks
 */

import type {
  FigmaFontRef,
  ResolvedFont,
  FontResolverConfig,
  FontAvailabilityChecker,
} from "./types";
import { figmaFontToQuery } from "./query";
import { COMMON_FONT_MAPPINGS, getDefaultFontStack, isGenericCssFontFamily } from "./mappings";

/**
 * Default font resolver configuration
 */
type ResolvedFontResolverConfig = {
  readonly fontMappings: ReadonlyMap<string, readonly string[]>;
  readonly defaultFontStack: readonly string[];
  readonly availabilityChecker: FontAvailabilityChecker;
};

const DEFAULT_FONT_STACK: readonly string[] = [];

const DEFAULT_CONFIG = {
  fontMappings: COMMON_FONT_MAPPINGS,
};

/**
 * Font resolver class
 *
 * Resolves Figma font references to CSS font stacks based on font
 * availability and mappings.
 */
/** Resolve an availability check that may be synchronous or async */
async function resolveAvailability(result: boolean | Promise<boolean>): Promise<boolean> {
  if (typeof result === "boolean") {
    return result;
  }
  return result;
}

/** Font resolver instance */
export type FontResolverInstance = {
  /** Resolve a Figma font reference to CSS font properties */
  resolve(fontRef: FigmaFontRef): ResolvedFont;
  /** Resolve a Figma font reference asynchronously */
  resolveAsync(fontRef: FigmaFontRef): Promise<ResolvedFont>;
  /** Clear the resolution cache */
  clearCache(): void;
};

/** Resolves Figma font names to CSS font stacks */
export function createFontResolver(config: FontResolverConfig): FontResolverInstance {
  const resolvedConfig: ResolvedFontResolverConfig = {
    fontMappings: config.fontMappings ?? DEFAULT_CONFIG.fontMappings,
    defaultFontStack: config.defaultFontStack ?? DEFAULT_FONT_STACK,
    availabilityChecker: config.availabilityChecker,
  };
  const cache = new Map<string, ResolvedFont>();

  function buildFontFamilyChain(family: string): readonly string[] {
    // Check custom mappings first
    const mapped = resolvedConfig.fontMappings.get(family);
    if (mapped) {
      return mapped;
    }

    // Check common mappings
    const common = COMMON_FONT_MAPPINGS.get(family);
    if (common) {
      return common;
    }

    const genericFontStack = getDefaultFontStack(family);
    return [family, ...genericFontStack, ...resolvedConfig.defaultFontStack];
  }

  function checkAvailability(family: string): boolean {
    const result = resolvedConfig.availabilityChecker.isAvailable(family);
    if (typeof result === "boolean") {
      return result;
    }
    throw new Error(`Font resolver resolve() received async availability for ${family}; use resolveAsync()`);
  }

  function buildFontFamilyString(chain: readonly string[]): string {
    return chain
      .map((f) => {
        // Don't quote generic family names
        if (isGenericCssFontFamily(f)) {
          return f;
        }
        // Quote family names that contain spaces or special characters
        if (f.includes(" ") || f.includes("-") || /^\d/.test(f)) {
          return `"${f}"`;
        }
        return f;
      })
      .join(", ");
  }

  function doResolve(fontRef: FigmaFontRef): ResolvedFont {
    // Defer (weight, style) detection to the canonical SoT.
    const query = figmaFontToQuery(fontRef);

    const fontFamilyChain = buildFontFamilyChain(query.family);
    const isExactMatch = checkAvailability(query.family);

    const fontFamily = buildFontFamilyString(fontFamilyChain);

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
      const fontFamilyChain = buildFontFamilyChain(query.family);

      // Check availability asynchronously
      if (!resolvedConfig.availabilityChecker) {
        throw new Error(`Font resolver requires an explicit availabilityChecker for ${query.family}`);
      }
      const availabilityResult = resolvedConfig.availabilityChecker.isAvailable(query.family);
      const isExactMatch = await resolveAvailability(availabilityResult);

      const fontFamily = buildFontFamilyString(fontFamilyChain);

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

/**
 * Browser font availability checker using CSS Font Loading API
 */
export function createBrowserAvailabilityChecker(): FontAvailabilityChecker {
  return {
    isAvailable(family: string): boolean | Promise<boolean> {
      if (typeof document === "undefined" || !document.fonts) {
        throw new Error("Browser font availability requires document.fonts");
      }

      // Check if font is already loaded
      const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      return document.fonts.check(`16px "${family}"`, testString);
    },
  };
}
