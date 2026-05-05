/**
 * @file Buzz document renderer boundary.
 */

import type { BuzzDocument } from "@higma-document-models/buzz";

export type BuzzRenderPlan = {
  readonly kind: "buzz";
  readonly document: BuzzDocument;
  readonly insights: BuzzDocument["insights"];
};

/** Create a buzz render plan without importing buzz IO or editor code. */
export function createBuzzRenderPlan(document: BuzzDocument): BuzzRenderPlan {
  return {
    kind: "buzz",
    document,
    insights: document.insights,
  };
}
