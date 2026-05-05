/**
 * @file Site document IO boundary.
 */

import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";
import { createFigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import { decodeFigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { summarizeFigmaNodes } from "@higma-figma-runtime/node-summary";
import { createSiteDocument, SITE_DOCUMENT_PROFILE, type SiteDocument } from "@higma-document-models/site";

/** Assert that raw canvas bytes belong to the site product profile. */
export function assertSiteCanvas(data: Uint8Array): void {
  const header = parseFigCanvasHeader(data);
  if (header.magic !== SITE_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected site canvas magic ${SITE_DOCUMENT_PROFILE.magic}, got ${header.magic}`);
  }
}

/** Load the site document shell after validating the product canvas magic. */
export async function loadSiteDocument(data: Uint8Array): Promise<SiteDocument> {
  const canvas = await decodeFigmaKiwiCanvas(data);
  if (canvas.header.magic !== SITE_DOCUMENT_PROFILE.magic) {
    throw new Error(`Expected site canvas magic ${SITE_DOCUMENT_PROFILE.magic}, got ${canvas.header.magic}`);
  }
  const summary = summarizeFigmaNodes(canvas.nodeChanges);
  return createSiteDocument(canvas, summary, createFigmaFormatInsights(canvas, summary));
}
