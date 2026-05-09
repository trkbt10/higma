/**
 * @file Build a "web font plan" from a set of `FontQuery` entries.
 *
 * The plan describes what a static HTML host needs in order to render
 * the same fonts the renderer chose: which families to fetch from a
 * web-font provider (Google Fonts by default), and the **minimum**
 * weight × style set for each — driven by the actual TEXT runs, not
 * a one-size-fits-all 100..900 sweep.
 *
 * Single SoT for `<link rel="stylesheet" href="…fonts.googleapis.com…">`
 * markup. Anywhere else that hard-codes `:wght@100;200;...;900` is
 * over-fetching and duplicating this logic.
 *
 * Why a plan and not a direct HTML emitter: the consumer is the
 * caller's HTML builder (`html-tree`, JSX, etc.). The plan is an
 * intermediate artefact so the same data drives:
 *   - `<link>` emission for fig-to-web's preview shell
 *   - `<link>` emission for the iframe-host of the authoritative
 *     Figma SVG render
 *   - any future emit target (e.g. an @font-face `<style>` block)
 */

import type { FontQuery } from "../query";
import type { FontStyle } from "../style";
import { isGenericCssFontFamily } from "../mappings";

/** Distinct (weight, style) combinations needed for a single family. */
export type WebFontFamilyPlan = {
  readonly family: string;
  /** Weights actually referenced by the source — never the full 100..900. */
  readonly weights: readonly number[];
  /** Styles actually referenced (`normal`, `italic`, `oblique`). */
  readonly styles: readonly FontStyle[];
};

export type WebFontPlan = {
  readonly families: readonly WebFontFamilyPlan[];
  /**
   * Fully built href to a Google Fonts stylesheet that satisfies
   * every `families[i]`. `undefined` when `families` is empty.
   */
  readonly googleFontsHref: string | undefined;
};

export type BuildWebFontPlanOptions = {
  /**
   * Filter the families to those a web-font provider can serve.
   * Default: skip generic CSS keywords (`sans-serif`, `system-ui`,
   * `monospace`, …) — they are intentionally OS-resolved. Caller can
   * supply additional family names to drop (e.g. proprietary fonts
   * the host can't fetch).
   *
   * The default already filters generic CSS keywords; this option is
   * an additional deny-list.
   */
  readonly skipFamilies?: ReadonlySet<string>;
};

/**
 * Build a `WebFontPlan` from the deduplicated query list.
 *
 * The plan is keyed by family. Within each family, weights and styles
 * are deduplicated and sorted (weights numeric ascending, styles by a
 * fixed `[normal, italic, oblique]` order). Generic CSS family keywords
 * are filtered out — they don't correspond to web fonts and would
 * pollute the URL.
 */
export function buildWebFontPlan(
  queries: readonly FontQuery[],
  options: BuildWebFontPlanOptions = {},
): WebFontPlan {
  const skipFamilies = options.skipFamilies;
  // Collect weights / styles per family.
  const byFamily = new Map<string, { weights: Set<number>; styles: Set<FontStyle> }>();
  for (const q of queries) {
    if (q.family.length === 0) {
      continue;
    }
    if (isGenericCssFontFamily(q.family)) {
      continue;
    }
    if (skipFamilies?.has(q.family)) {
      continue;
    }
    const slot = byFamily.get(q.family);
    if (slot) {
      slot.weights.add(q.weight);
      slot.styles.add(q.style);
      continue;
    }
    byFamily.set(q.family, {
      weights: new Set<number>([q.weight]),
      styles: new Set<FontStyle>([q.style]),
    });
  }

  const families: WebFontFamilyPlan[] = [];
  for (const [family, { weights, styles }] of byFamily) {
    families.push({
      family,
      weights: [...weights].sort((a, b) => a - b),
      styles: sortStyles(styles),
    });
  }
  families.sort((a, b) => a.family.localeCompare(b.family));

  const googleFontsHref = families.length > 0 ? buildGoogleFontsHref(families) : undefined;

  return { families, googleFontsHref };
}

/** Stable order so the resulting URL is deterministic across runs. */
function sortStyles(styles: ReadonlySet<FontStyle>): readonly FontStyle[] {
  const order: readonly FontStyle[] = ["normal", "italic", "oblique"];
  return order.filter((s) => styles.has(s));
}

/**
 * Build the Google Fonts CSS2 href for a plan.
 *
 * Format reference: https://developers.google.com/fonts/docs/css2
 *
 *   family=Foo:ital,wght@0,400;0,700;1,400
 *
 * Italic / oblique map to `ital=1`. Oblique is requested as italic
 * because Google Fonts does not expose oblique variants separately;
 * the substitution is the same one CSS does on the client when the
 * exact style is unavailable.
 */
function buildGoogleFontsHref(families: readonly WebFontFamilyPlan[]): string {
  const params = families.map(buildFamilyParam).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

function buildFamilyParam(plan: WebFontFamilyPlan): string {
  const familyEncoded = encodeURIComponent(plan.family);
  // Build [(ital, wght)] tuples sorted by ital ascending then wght ascending.
  // Google Fonts requires this exact ordering or returns 400 Bad Request.
  const tuples: { readonly ital: 0 | 1; readonly wght: number }[] = [];
  const wantsItal = plan.styles.includes("italic") || plan.styles.includes("oblique");
  const wantsUpright = plan.styles.includes("normal") || plan.styles.length === 0;
  for (const w of plan.weights) {
    if (wantsUpright) {
      tuples.push({ ital: 0, wght: w });
    }
    if (wantsItal) {
      tuples.push({ ital: 1, wght: w });
    }
  }
  tuples.sort((a, b) => (a.ital - b.ital) || (a.wght - b.wght));
  const tupleSegment = tuples.map((t) => `${t.ital},${t.wght}`).join(";");
  return `family=${familyEncoded}:ital,wght@${tupleSegment}`;
}
