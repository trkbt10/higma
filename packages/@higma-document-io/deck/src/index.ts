/**
 * @file Deck document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { loadFigmaDocumentFacts, type FigmaDocumentFacts } from "@higma-figma-analysis/document-facts";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { createDeckDocument, DECK_DOCUMENT_PROFILE, type DeckDocument } from "@higma-document-models/deck";

export type DeckDocumentLoadResult = {
  readonly document: DeckDocument;
  readonly facts: FigmaDocumentFacts;
};

/** Assert that raw canvas bytes belong to the deck product profile. */
export function assertDeckCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== DECK_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected deck canvas magic ${DECK_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load deck document facts and create the product model. */
export async function loadDeckDocumentResult(data: Uint8Array): Promise<DeckDocumentLoadResult> {
  const facts = await loadFigmaDocumentFacts(data, DECK_DOCUMENT_PROFILE);
  return {
    document: createDeckDocument(facts.canvas, facts.summary, createFigmaFormatInsights(facts.canvas, facts.summary)),
    facts,
  };
}

/** Load a deck document model from raw or packaged document bytes. */
export async function loadDeckDocument(data: Uint8Array): Promise<DeckDocument> {
  const result = await loadDeckDocumentResult(data);
  return result.document;
}
