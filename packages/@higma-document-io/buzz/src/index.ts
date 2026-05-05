/**
 * @file Buzz document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { decodeFigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { summarizeFigmaNodes } from "@higma-figma-runtime/node-summary";
import { createBuzzDocument, BUZZ_DOCUMENT_PROFILE, type BuzzDocument } from "@higma-document-models/buzz";

/** Assert that raw canvas bytes belong to the buzz product profile. */
export function assertBuzzCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== BUZZ_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected buzz canvas magic ${BUZZ_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load the buzz document shell after validating the product canvas magic. */
export async function loadBuzzDocument(data: Uint8Array): Promise<BuzzDocument> {
  const canvas = await decodeFigmaKiwiCanvas(data);
  if (canvas.header.magic !== BUZZ_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected buzz canvas magic ${BUZZ_DOCUMENT_PROFILE.magic}, got ${canvas.header.magic}`);
  }
  const summary = summarizeFigmaNodes(canvas.nodeChanges);
  return createBuzzDocument(canvas, summary, createFigmaFormatInsights(canvas, summary));
}
