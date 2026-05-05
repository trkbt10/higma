/**
 * @file Site document renderer boundary.
 */

import { createSiteDomainSummary, type SiteDocument, type SiteDomainSummary } from "@higma-document-models/site";
import { createFigmaRenderOutline, type FigmaRenderOutline } from "@higma-figma-analysis/render-outline";

export type SiteRenderRole = "cms-rich-text" | "repeater" | "responsive-set" | "symbol" | "instance";

const SITE_RENDER_ROLES = [
  { nodeType: "CMS_RICH_TEXT", role: "cms-rich-text" },
  { nodeType: "REPEATER", role: "repeater" },
  { nodeType: "RESPONSIVE_SET", role: "responsive-set" },
  { nodeType: "SYMBOL", role: "symbol" },
  { nodeType: "INSTANCE", role: "instance" },
] as const;

export type SiteRenderPlan = {
  readonly kind: "site";
  readonly document: SiteDocument;
  readonly insights: SiteDocument["insights"];
  readonly domainSummary: SiteDomainSummary;
  readonly renderOutline: FigmaRenderOutline<SiteRenderRole>;
};

/** Create a site render plan with explicit layout render units. */
export function createSiteRenderPlan(document: SiteDocument): SiteRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, SITE_RENDER_ROLES);
  if (renderOutline.entries.length === 0) {
    throw new Error("Site render plan requires at least one layout render unit");
  }
  return {
    kind: "site",
    document,
    insights: document.insights,
    domainSummary: createSiteDomainSummary(document),
    renderOutline,
  };
}
