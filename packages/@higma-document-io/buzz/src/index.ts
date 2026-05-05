/**
 * @file Buzz document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { loadFigmaDocumentFacts, type FigmaDocumentFacts } from "@higma-figma-analysis/document-facts";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { createBuzzDocument, BUZZ_DOCUMENT_PROFILE, type BuzzDocument } from "@higma-document-models/buzz";

export type BuzzDocumentLoadResult = {
  readonly document: BuzzDocument;
  readonly facts: FigmaDocumentFacts;
};

/** Assert that raw canvas bytes belong to the buzz product profile. */
export function assertBuzzCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== BUZZ_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected buzz canvas magic ${BUZZ_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load buzz document facts and create the product model. */
export async function loadBuzzDocumentResult(data: Uint8Array): Promise<BuzzDocumentLoadResult> {
  const facts = await loadFigmaDocumentFacts(data, BUZZ_DOCUMENT_PROFILE);
  return {
    document: createBuzzDocument(facts.canvas, facts.summary, createFigmaFormatInsights(facts.canvas, facts.summary)),
    facts,
  };
}

/** Load a buzz document model from raw or packaged document bytes. */
export async function loadBuzzDocument(data: Uint8Array): Promise<BuzzDocument> {
  const result = await loadBuzzDocumentResult(data);
  return result.document;
}
