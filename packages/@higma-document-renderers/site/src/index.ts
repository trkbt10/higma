/**
 * @file Site document renderer boundary.
 */

import type { SiteDocument } from "@higma-document-models/site";

export type SiteRenderPlan = {
  readonly kind: "site";
  readonly document: SiteDocument;
  readonly insights: SiteDocument["insights"];
};

/** Create a site render plan without importing site IO or editor code. */
export function createSiteRenderPlan(document: SiteDocument): SiteRenderPlan {
  return {
    kind: "site",
    document,
    insights: document.insights,
  };
}
