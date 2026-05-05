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

export type DeckDomainSummary = {
  readonly slideGridCount: number;
  readonly slideRowCount: number;
  readonly slideCount: number;
  readonly interactiveElementCount: number;
  readonly presentationNodeCount: number;
};

export const DECK_DOCUMENT_PROFILE: DeckDocumentProfile = {
  name: "deck",
  magic: "fig-deck",
  extension: ".deck",
  domain: "presentation",
};

function nodeTypeCount(document: DeckDocument, nodeType: string): number {
  return document.summary.nodeTypes.get(nodeType) ?? 0;
}

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

/** Summarize presentation-specific node families in a deck document. */
export function createDeckDomainSummary(document: DeckDocument): DeckDomainSummary {
  const slideGridCount = nodeTypeCount(document, "SLIDE_GRID");
  const slideRowCount = nodeTypeCount(document, "SLIDE_ROW");
  const slideCount = nodeTypeCount(document, "SLIDE");
  const interactiveElementCount = nodeTypeCount(document, "INTERACTIVE_SLIDE_ELEMENT");
  return {
    slideGridCount,
    slideRowCount,
    slideCount,
    interactiveElementCount,
    presentationNodeCount: slideGridCount + slideRowCount + slideCount + interactiveElementCount,
  };
}
