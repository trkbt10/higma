/**
 * @file Icon-asset registry — externalises complex vector subtrees as
 * standalone `.svg` files under `assets/icons/`.
 *
 * The decision to externalise is driven by
 * `complexityScore(node, { blobs })` from
 * `@higma-document-renderers/fig/asset-plan`. The same scorer powers
 * fig-to-swiftui's rasterisation gate; sharing the heuristic keeps
 * "is this subtree heavy enough to externalise?" answered the same
 * way across emitters.
 *
 * Each register call:
 *   - generates a stable slug (Figma node name + node-key fallback)
 *   - dedups duplicate registrations (same key → same file)
 *   - returns the relative path the JSX emitter writes into the
 *     `<img src="…" />` reference
 *
 * The icon files land alongside image assets so the user has one
 * `assets/` directory to track. Image (raster) paints live at
 * `assets/<hash>.<ext>`; icons land at `assets/icons/<slug>.svg`.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { toCssSlug, uniqueId } from "@higma-primitives/identifier";
import { guidToString } from "@higma-document-models/fig/domain";

export type IconAsset = {
  readonly path: string;
  readonly contents: string;
};

export type IconRegistry = {
  /**
   * Register an SVG payload for an externalised vector node. Returns the
   * root-absolute asset URL (`/assets/icons/<slug>.svg`) that an
   * `<img src="…" />` reference should carry — root-absolute so it
   * resolves from the served root at any page depth (standalone pages
   * sit three directories deep; a document-relative `./assets/…` 404s).
   */
  readonly register: (node: FigNode, svgText: string) => string;
  /** Snapshot every asset registered so far. */
  readonly collected: () => readonly IconAsset[];
};

/**
 * Build a fresh icon registry. State is scoped to one `emitFromFrames`
 * call so the slug counter restarts per run and the produced output
 * directory stays deterministic.
 */
export function createIconRegistry(): IconRegistry {
  const usedSlugs = new Set<string>();
  const byKey = new Map<string, string>();
  const assets: IconAsset[] = [];
  return {
    register: (node, svgText) => {
      const key = guidToString(node.guid);
      const existing = byKey.get(key);
      if (existing !== undefined) {
        return existing;
      }
      // The icon's filesystem slug derives from the Figma node's
      // authored layer name. A missing / blank name is a data
      // contract violation: every Figma frame / vector that reaches
      // this code path was authored in Figma and carries a name
      // (Figma auto-generates "Vector", "Frame 24", etc. when the
      // designer doesn't pick one — so blank means something
      // upstream stripped the name). Falling back to a guid-derived
      // slug would silently hide that bug; throw so the caller has
      // to address the root cause per the fail-fast policy.
      if (!node.name || node.name.trim().length === 0) {
        throw new Error(
          `icons: cannot externalise vector node ${key}: layer name is empty. ` +
          `The asset slug derives from the authored Figma layer name; an empty name suggests ` +
          `an upstream pipeline dropped it. Inspect the source .fig file or skip this node.`,
        );
      }
      const baseSlug = toCssSlug(node.name);
      const slug = uniqueId(baseSlug, usedSlugs);
      const path = `assets/icons/${slug}.svg`;
      assets.push({ path, contents: svgText });
      const reference = `/${path}`;
      byKey.set(key, reference);
      return reference;
    },
    collected: () => assets,
  };
}
