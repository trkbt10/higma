/**
 * @file `@higma-tools/refine-fig` — public entry.
 *
 * Three layers, exported as sub-paths in package.json:
 *
 *   - analysis  — palette, typography, naming, duplicate-cluster
 *                 detection. All pure functions over a refine source.
 *   - plan      — a serialisable `RefinePlan` shape combining the
 *                 analyses, ready for human review or apply.
 *   - apply     — mutate a `LoadedFigFile` per plan (in place).
 *   - visual    — render any FigNode subtree to PNG with memoisation
 *                 plus perceptual hashing for visual diff.
 *
 * Top-level convenience exports cover the most common entry points
 * (`loadRefineSource`, `buildPlan`, `applyPlan`) so a script can wire
 * the full pipeline with a single import.
 */
export { loadRefineSource } from "./refine-source/load";
export type { RefineSource } from "./refine-source/load";
export { buildPlan } from "./plan";
export type { BuildPlanOptions, RefinePlan } from "./plan";
export { applyPlan } from "./apply";
export type { ApplyResult } from "./apply";
export { createNodeRenderer, perceptualHash, combinedDistance } from "./visual";
export type { NodeRenderer, RenderedNode, PerceptualHash } from "./visual";
