/**
 * @file Deck document renderer boundary.
 */

import { createDeckDomainSummary, type DeckDocument, type DeckDomainSummary } from "@higma-document-models/deck";
import { createFigmaRenderOutline, type FigmaRenderOutline } from "@higma-figma-analysis/render-outline";

export type DeckRenderRole = "slide-grid" | "slide-row" | "slide" | "interactive-slide-element";

const DECK_RENDER_ROLES = [
  { nodeType: "SLIDE_GRID", role: "slide-grid" },
  { nodeType: "SLIDE_ROW", role: "slide-row" },
  { nodeType: "SLIDE", role: "slide" },
  { nodeType: "INTERACTIVE_SLIDE_ELEMENT", role: "interactive-slide-element" },
] as const;

export type DeckRenderPlan = {
  readonly kind: "deck";
  readonly document: DeckDocument;
  readonly insights: DeckDocument["insights"];
  readonly domainSummary: DeckDomainSummary;
  readonly renderOutline: FigmaRenderOutline<DeckRenderRole>;
};

/** Create a deck render plan with explicit presentation render units. */
export function createDeckRenderPlan(document: DeckDocument): DeckRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, DECK_RENDER_ROLES);
  if (renderOutline.entries.length === 0) {
    throw new Error("Deck render plan requires at least one presentation render unit");
  }
  return {
    kind: "deck",
    document,
    insights: document.insights,
    domainSummary: createDeckDomainSummary(document),
    renderOutline,
  };
}
