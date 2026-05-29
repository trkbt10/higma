/**
 * @file Layout-sizing mode registry — the single place that maps a
 * {@link LayoutSizing} mode to its emit configuration.
 *
 * Keeping the dispatch here (in the layout layer) rather than in the
 * render orchestration means adding a new sizing mode is a local change:
 * write its transform as a sibling module (the way `liquid.ts` provides
 * `liquefyStyle`) and add one `case` below. `render/files.ts` stays
 * mode-agnostic — it asks for "the config for this mode" and threads the
 * result onto the emit context without knowing which modes exist.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { LiquidConfig } from "./liquid";

/**
 * Sizing regime applied to the web-inferred layout as a post-process.
 *
 * - `"fixed"` (default): every authored dimension is emitted as an
 *   absolute `px` length — the historical behaviour. Pixel-faithful at
 *   the frame's authored width, but does not adapt to the viewport.
 * - `"liquid"`: every length is rewritten to `calc(L/W*100 * var(--lqd))`
 *   against a capped per-viewport scale unit `--lqd: min(1vw, W/100px)`,
 *   so the whole design shrinks uniformly below the authored width `W`
 *   and freezes at it above — preserving aspect ratio (see `liquid.ts`).
 *   Orthogonal to `cssMode`: the chosen CSS-delivery strategy runs
 *   downstream on the rewritten values.
 */
export type LayoutSizing = "fixed" | "liquid";

/**
 * Resolve the emit config for `root` under the chosen mode: a
 * {@link LiquidConfig} (the design width to scale against) for liquid,
 * or `undefined` for fixed (and when the root has no authored size). The
 * dispatch is exhaustive over {@link LayoutSizing} so a new mode must be
 * handled here before it can reach the emitter.
 */
export function buildLiquidConfig(mode: LayoutSizing, root: FigNode): LiquidConfig | undefined {
  switch (mode) {
    case "fixed":
      return undefined;
    case "liquid":
      return root.size ? { designWidth: root.size.x } : undefined;
  }
}
