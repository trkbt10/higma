/**
 * @file Font module — environment-neutral font resolution SoT.
 *
 * Single source of truth for:
 *   - `FontQuery` (canonical "which font" descriptor)
 *   - weight / style detection
 *   - generic family stacks + Figma → CSS family mappings
 *   - the abstract `FontLoader` interface and caching wrappers
 *   - the abstract `AbstractFont` shape consumed by drivers
 *
 * Environment-specific font loaders (Node fs, browser Local Font Access
 * API) live in `@higma-document-renderers/fig/font-drivers/*` because
 * they require `opentype.js` / DOM APIs the model layer must not depend on.
 *
 * Higher-level helpers — TEXT-subtree font collection, preload + resolver
 * construction, web-font emission planning — live under `./context`. They
 * are the canonical implementation of "given a Figma document tree, give
 * me the (queries / preloads / web font links) I need".
 */

// Types
//
// `PathCommand` lives in `@higma-primitives/path` (the SoT); consumers
// import it directly from that package. Re-publishing it via this
// barrel is forbidden by the `no-cross-package-reexport` lint rule.
export type {
  AbstractFont,
  AbstractGlyph,
  FontPath,
  LoadedFont,
  FigmaFontRef,
  ResolvedFont,
  FontAvailability,
  FontVariant,
  FontResolverConfig,
  FontAvailabilityChecker,
  FontMetrics,
} from "./types";

export type { FontLoader } from "./loader";

// FontQuery — single source of truth for "which font do we want?"
export {
  type FontQuery,
  figmaFontToQuery,
  fontQueryKey,
  fontQueryEqual,
  fontQueryToStyleName,
} from "./query";

// Weight detection
export { FONT_WEIGHTS, type FontWeight, detectWeight, normalizeWeight, getWeightName, figmaWeightLabel } from "./weight";

// Style detection
export { type FontStyle, detectStyle, isItalic, isOblique, isSlanted } from "./style";

// Font family mappings
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
  buildCssFontFamily,
  buildCssFontFamilyChain,
  buildCssFontShorthand,
  quoteCssFamily,
} from "./mappings";

// Font resolver (Figma fontRef → CSS font stack)
export { createFontResolver, createBrowserAvailabilityChecker, type FontResolverInstance } from "./resolver";

// Font cache
export { createFontCache, type FontCache, createCachingFontLoader, type CachingFontLoader } from "./cache";

// Helpers
export { fontHasGlyph } from "./helpers";

// Context layer — TEXT collection, preload, web-font plan
export type {
  CollectFontQueriesInput,
  CollectFontQueriesResult,
  WebFontPlan,
  WebFontFamilyPlan,
  PreloadFontsInput,
  PreloadFontsResult,
} from "./context";
export {
  collectFontQueries,
  buildWebFontPlan,
  preloadFonts,
} from "./context";
