/**
 * @file Site document model boundary.
 */

import type { FigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigmaNodeSummary } from "@higma-figma-runtime/node-summary";
import type { FigSchemaProfile } from "@higma-figma-schema/profiles";

export type SiteDocumentKind = "site";

export type SiteDocumentProfile = FigSchemaProfile & {
  readonly name: SiteDocumentKind;
  readonly extension: ".site";
  readonly domain: "site";
};

export type SiteDocument = {
  readonly kind: SiteDocumentKind;
  readonly profile: SiteDocumentProfile;
  readonly canvas: FigmaKiwiCanvas;
  readonly summary: FigmaNodeSummary;
  readonly insights: FigmaFormatInsights;
};

export const SITE_DOCUMENT_PROFILE: SiteDocumentProfile = {
  name: "site",
  magic: "fig-site",
  extension: ".site",
  domain: "site",
};

/** Create a site document from decoded fig-family canvas data. */
export function createSiteDocument(
  canvas: FigmaKiwiCanvas,
  summary: FigmaNodeSummary,
  insights: FigmaFormatInsights,
): SiteDocument {
  return {
    kind: "site",
    profile: SITE_DOCUMENT_PROFILE,
    canvas,
    summary,
    insights,
  };
}
