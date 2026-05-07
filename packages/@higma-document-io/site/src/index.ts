/**
 * @file Site document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { loadFigmaDocumentFacts, type FigmaDocumentFacts } from "@higma-figma-analysis/document-facts";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { createSiteDocument, SITE_DOCUMENT_PROFILE, type SiteDocument } from "@higma-document-models/site";
import { applySiteUnitMovesToNodeChanges, type SiteUnitMove } from "@higma-document-renderers/site";
import { loadFigFamilyFile, saveFigFamilyFile } from "@higma-figma-runtime/roundtrip";

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

/** Export original site bytes after applying direct editor unit moves to the fig-family node changes. */
export async function exportEditedSiteDocument(
  data: Uint8Array,
  moves: readonly SiteUnitMove[],
): Promise<Uint8Array> {
  const loaded = await loadFigFamilyFile(data);
  if (loaded.canvasMagic !== SITE_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected site canvas magic ${SITE_DOCUMENT_PROFILE.magic}, got ${loaded.canvasMagic}`);
  }
  return saveFigFamilyFile({
    ...loaded,
    nodeChanges: applySiteUnitMovesToNodeChanges(loaded.nodeChanges, moves),
  }, {
    canvasMagic: SITE_DOCUMENT_PROFILE.magic,
  });
}
