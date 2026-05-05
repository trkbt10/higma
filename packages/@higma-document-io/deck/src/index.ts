/**
 * @file Deck document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { decodeFigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { summarizeFigmaNodes } from "@higma-figma-runtime/node-summary";
import { createDeckDocument, DECK_DOCUMENT_PROFILE, type DeckDocument } from "@higma-document-models/deck";

/** Assert that raw canvas bytes belong to the deck product profile. */
export function assertDeckCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== DECK_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected deck canvas magic ${DECK_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load the deck document shell after validating the product canvas magic. */
export async function loadDeckDocument(data: Uint8Array): Promise<DeckDocument> {
  const canvas = await decodeFigmaKiwiCanvas(data);
  if (canvas.header.magic !== DECK_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected deck canvas magic ${DECK_DOCUMENT_PROFILE.magic}, got ${canvas.header.magic}`);
  }
  const summary = summarizeFigmaNodes(canvas.nodeChanges);
  return createDeckDocument(canvas, summary, createFigmaFormatInsights(canvas, summary));
}
