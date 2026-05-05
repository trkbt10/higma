/**
 * @file Deck document renderer boundary.
 */

import { createDeckDomainSummary, type DeckDocument, type DeckDomainSummary } from "@higma-document-models/deck";

export type DeckRenderPlan = {
  readonly kind: "deck";
  readonly document: DeckDocument;
  readonly insights: DeckDocument["insights"];
  readonly domainSummary: DeckDomainSummary;
};

/** Create a deck render plan without importing deck IO or editor code. */
export function createDeckRenderPlan(document: DeckDocument): DeckRenderPlan {
  return {
    kind: "deck",
    document,
    insights: document.insights,
    domainSummary: createDeckDomainSummary(document),
  };
}
