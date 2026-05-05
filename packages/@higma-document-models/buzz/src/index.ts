/**
 * @file Buzz document model boundary.
 */

import type { FigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigmaNodeSummary } from "@higma-figma-runtime/node-summary";
import type { FigSchemaProfile } from "@higma-figma-schema/profiles";

export type BuzzDocumentKind = "buzz";

export type BuzzDocumentProfile = FigSchemaProfile & {
  readonly name: BuzzDocumentKind;
  readonly extension: ".buzz";
  readonly domain: "template";
};

export type BuzzDocument = {
  readonly kind: BuzzDocumentKind;
  readonly profile: BuzzDocumentProfile;
  readonly canvas: FigmaKiwiCanvas;
  readonly summary: FigmaNodeSummary;
  readonly insights: FigmaFormatInsights;
};

export const BUZZ_DOCUMENT_PROFILE: BuzzDocumentProfile = {
  name: "buzz",
  magic: "fig-buzz",
  extension: ".buzz",
  domain: "template",
};

/** Create a buzz document from decoded fig-family canvas data. */
export function createBuzzDocument(
  canvas: FigmaKiwiCanvas,
  summary: FigmaNodeSummary,
  insights: FigmaFormatInsights,
): BuzzDocument {
  return {
    kind: "buzz",
    profile: BUZZ_DOCUMENT_PROFILE,
    canvas,
    summary,
    insights,
  };
}
