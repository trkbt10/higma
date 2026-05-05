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

export type SiteDomainSummary = {
  readonly cmsRichTextCount: number;
  readonly repeaterCount: number;
  readonly responsiveSetCount: number;
  readonly symbolCount: number;
  readonly instanceCount: number;
  readonly layoutNodeCount: number;
};

export const SITE_DOCUMENT_PROFILE: SiteDocumentProfile = {
  name: "site",
  magic: "fig-site",
  extension: ".site",
  domain: "site",
};

function nodeTypeCount(document: SiteDocument, nodeType: string): number {
  return document.summary.nodeTypes.get(nodeType) ?? 0;
}

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

/** Summarize site/layout-specific node families in a site document. */
export function createSiteDomainSummary(document: SiteDocument): SiteDomainSummary {
  const cmsRichTextCount = nodeTypeCount(document, "CMS_RICH_TEXT");
  const repeaterCount = nodeTypeCount(document, "REPEATER");
  const responsiveSetCount = nodeTypeCount(document, "RESPONSIVE_SET");
  const symbolCount = nodeTypeCount(document, "SYMBOL");
  const instanceCount = nodeTypeCount(document, "INSTANCE");
  return {
    cmsRichTextCount,
    repeaterCount,
    responsiveSetCount,
    symbolCount,
    instanceCount,
    layoutNodeCount: cmsRichTextCount + repeaterCount + responsiveSetCount + symbolCount + instanceCount,
  };
}
