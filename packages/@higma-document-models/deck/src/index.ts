/**
 * @file Deck document model boundary.
 */

import type { FigmaFormatInsights } from "@higma-figma-analysis/format-insights";
import type { FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import type { FigmaNodeSummary } from "@higma-figma-runtime/node-summary";
import type { FigSchemaProfile } from "@higma-figma-schema/profiles";

export type DeckDocumentKind = "deck";

export type DeckDocumentProfile = FigSchemaProfile & {
  readonly name: DeckDocumentKind;
  readonly extension: ".deck";
  readonly domain: "presentation";
};

export type DeckDocument = {
  readonly kind: DeckDocumentKind;
  readonly profile: DeckDocumentProfile;
  readonly canvas: FigmaKiwiCanvas;
  readonly summary: FigmaNodeSummary;
  readonly insights: FigmaFormatInsights;
};

export const DECK_DOCUMENT_PROFILE: DeckDocumentProfile = {
  name: "deck",
  magic: "fig-deck",
  extension: ".deck",
  domain: "presentation",
};

/** Create a deck document from decoded fig-family canvas data. */
export function createDeckDocument(
  canvas: FigmaKiwiCanvas,
  summary: FigmaNodeSummary,
  insights: FigmaFormatInsights,
): DeckDocument {
  return {
    kind: "deck",
    profile: DECK_DOCUMENT_PROFILE,
    canvas,
    summary,
    insights,
  };
}
