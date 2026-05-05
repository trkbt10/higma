/**
 * @file Site document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { loadFigmaDocumentFacts, type FigmaDocumentFacts } from "@higma-figma-analysis/document-facts";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { createSiteDocument, SITE_DOCUMENT_PROFILE, type SiteDocument } from "@higma-document-models/site";

export type SiteDocumentLoadResult = {
  readonly document: SiteDocument;
  readonly facts: FigmaDocumentFacts;
};

/** Assert that raw canvas bytes belong to the site product profile. */
export function assertSiteCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== SITE_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected site canvas magic ${SITE_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load site document facts and create the product model. */
export async function loadSiteDocumentResult(data: Uint8Array): Promise<SiteDocumentLoadResult> {
  const facts = await loadFigmaDocumentFacts(data, SITE_DOCUMENT_PROFILE);
  return {
    document: createSiteDocument(facts.canvas, facts.summary, createFigmaFormatInsights(facts.canvas, facts.summary)),
    facts,
  };
}

/** Load a site document model from raw or packaged document bytes. */
export async function loadSiteDocument(data: Uint8Array): Promise<SiteDocument> {
  const result = await loadSiteDocumentResult(data);
  return result.document;
}
