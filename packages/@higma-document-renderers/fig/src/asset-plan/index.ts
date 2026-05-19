/**
 * @file Shared asset-planning primitives.
 *
 * Lives in `@higma-document-renderers/fig` because every tool that
 * targets a stronger output format (SwiftUI's type-checker, the
 * HTML/SVG payload size, …) faces the same trade-off: emit a complex
 * subtree as code or as a flattened asset (PNG, SVG file). The
 * decision is the same; the asset format differs by target.
 *
 * `complexityScore` is the shared numerical signal. Per-tool routines
 * (`fig-to-swiftui/emit/rasterize.ts`, the upcoming
 * `fig-to-web` icon-externalisation path) build naming / output rules
 * on top of it.
 */
export { complexityScore, type ComplexityOptions } from "./complexity";
