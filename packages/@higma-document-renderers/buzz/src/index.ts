/**
 * @file Buzz document renderer boundary.
 */

import { createBuzzDomainSummary, type BuzzDocument, type BuzzDomainSummary } from "@higma-document-models/buzz";

export type BuzzRenderPlan = {
  readonly kind: "buzz";
  readonly document: BuzzDocument;
  readonly insights: BuzzDocument["insights"];
  readonly domainSummary: BuzzDomainSummary;
};

/** Create a buzz render plan without importing buzz IO or editor code. */
export function createBuzzRenderPlan(document: BuzzDocument): BuzzRenderPlan {
  return {
    kind: "buzz",
    document,
    insights: document.insights,
    domainSummary: createBuzzDomainSummary(document),
  };
}
