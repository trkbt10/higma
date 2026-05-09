/**
 * @file SoT for emitting `<link>` markup that loads web fonts referenced
 * by a fig-to-web bundle.
 *
 * Driven by `WebFontPlan` from `@higma-document-models/fig/font` —
 * which carries the **exact** weight × style combinations the source
 * actually uses, not a 100..900 sweep. Two emit sites previously had
 * the same Google Fonts URL builder open-coded; this module is the
 * single point that constructs the markup so over-fetching can never
 * silently regress.
 */
import { el } from "../lib/html-tree/builder";
import type { HtmlNode } from "../lib/html-tree/types";
import type { WebFontPlan } from "@higma-document-models/fig/font";

/**
 * Build the `<link rel="preconnect">` × 2 + `<link rel="stylesheet">`
 * triple a static HTML host needs to load the planned web fonts.
 *
 * Returns an empty array when the plan has no families — the host
 * still has the OS / generic font-family stack via the renderer's
 * normal fallback chain.
 */
export function renderFontLinkNodes(plan: WebFontPlan): readonly HtmlNode[] {
  if (plan.googleFontsHref === undefined) {
    return [];
  }
  return [
    el("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }),
    el("link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }),
    el("link", { rel: "stylesheet", href: plan.googleFontsHref }),
  ];
}
