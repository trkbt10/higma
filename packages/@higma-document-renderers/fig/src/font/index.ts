/**
 * @file Font module - browser-compatible font utilities
 *
 * This module provides font resolution, weight/style detection, and caching
 * without any Node.js dependencies. Environment-specific font loaders are
 * available in separate packages:
 *
 * - @higma-document-renderers/fig/font-drivers/node - Node.js filesystem loader
 * - @higma-document-renderers/fig/font-drivers/browser - Browser Local Font Access API loader
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Abstract font types (opentype.js compatible)
  AbstractFont,
  AbstractGlyph,
  FontPath,
  PathCommand,

  // Font loader types
  LoadedFont,
  FontLoadOptions,

  // Font resolution types
  FigmaFontRef,
  ResolvedFont,
  FontAvailability,
  FontVariant,
  FontResolverConfig,
  FontAvailabilityChecker,
  FontMetrics,
} from "./types";

export type { FontLoader } from "./loader";

// =============================================================================
// FontQuery — single source of truth for "which font do we want?"
// =============================================================================

export {
  type FontQuery,
  figmaFontToQuery,
  fontQueryKey,
  fontQueryEqual,
} from "./query";

// =============================================================================
// Weight Detection
// =============================================================================

export { FONT_WEIGHTS, type FontWeight, detectWeight, normalizeWeight, getWeightName } from "./weight";

// =============================================================================
// Style Detection
// =============================================================================

export { type FontStyle, detectStyle, isItalic, isOblique, isSlanted } from "./style";

// =============================================================================
// Font Mappings
// =============================================================================

export {
  SYSTEM_UI_STACK,
  MONOSPACE_STACK,
  SERIF_STACK,
  SANS_SERIF_STACK,
  COMMON_FONT_MAPPINGS,
  GENERIC_FONT_STACKS,
  GENERIC_CSS_FONT_FAMILIES,
  detectFontCategory,
  getDefaultFontStack,
  isGenericCssFontFamily,
} from "./mappings";

// =============================================================================
// Font Resolver
// =============================================================================

export { createFontResolver, createBrowserAvailabilityChecker, type FontResolverInstance } from "./resolver";

// =============================================================================
// Font Cache
// =============================================================================

export { createFontCache, type FontCache, createCachingFontLoader, type CachingFontLoader } from "./cache";

// =============================================================================
// Helpers
// =============================================================================

export { fontHasGlyph } from "./helpers";
