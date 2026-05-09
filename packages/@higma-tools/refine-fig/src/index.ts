/**
 * @file `@higma-tools/refine-fig` — public entry.
 *
 * Layers exposed as sub-paths in package.json:
 *
 *   - inventory  — facts about the file (palette, typography, clusters)
 *   - analysis   — low-level helpers shared between inventory and the
 *                  upcoming plan layer (palette / signature / hashing)
 *   - visual     — render any FigNode subtree to PNG with memoisation,
 *                  perceptual hash, frame-level renderer + diff
 *
 * Plan / apply / workbench were removed as part of the redesign that
 * moves naming and proxy creation out of heuristics and onto an agent
 * authored decisions JSON. They will be reintroduced as the rebuild
 * lands.
 */
export { loadRefineSource } from "./refine-source/load";
export type { RefineSource } from "./refine-source/load";
export { buildInventory } from "./inventory";
export type { Inventory } from "./inventory";
export { createNodeRenderer, perceptualHash, combinedDistance } from "./visual";
export type { NodeRenderer, RenderedNode, PerceptualHash } from "./visual";
