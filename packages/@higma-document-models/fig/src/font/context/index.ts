/**
 * @file Font context — TEXT node scanning, preload, and web-font plan SoT.
 *
 * The "context" sits between parser-emitted Figma nodes and the
 * rendering / emit backends:
 *
 *   parser (raw FigNode)
 *     ↓
 *   font/context: collectFontQueries → FontQuery[]
 *                 preloadFonts(loader, queries) → cache
 *                 buildWebFontPlan(queries) → <link> plan
 *     ↓
 *   builder / renderer (consumes deterministic outputs)
 */

export {
  collectFontQueries,
  type CollectFontQueriesInput,
  type CollectFontQueriesResult,
} from "./collect-queries";

export {
  preloadFonts,
  type PreloadFontsInput,
  type PreloadFontsResult,
} from "./preload-fonts";

export {
  buildWebFontPlan,
  type BuildWebFontPlanOptions,
  type WebFontFamilyPlan,
  type WebFontPlan,
} from "./web-font-plan";
