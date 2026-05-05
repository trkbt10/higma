/**
 * @file Buzz document renderer boundary.
 */

import { createBuzzDomainSummary, type BuzzDocument, type BuzzDomainSummary } from "@higma-document-models/buzz";
import { createFigmaRenderOutline, type FigmaRenderOutline } from "@higma-figma-analysis/render-outline";

export type BuzzRenderRole = "slide-grid" | "slide-row" | "symbol" | "vector" | "boolean-operation";

const BUZZ_RENDER_ROLES = [
  { nodeType: "SLIDE_GRID", role: "slide-grid" },
  { nodeType: "SLIDE_ROW", role: "slide-row" },
  { nodeType: "SYMBOL", role: "symbol" },
  { nodeType: "VECTOR", role: "vector" },
  { nodeType: "BOOLEAN_OPERATION", role: "boolean-operation" },
] as const;

export type BuzzRenderPlan = {
  readonly kind: "buzz";
  readonly document: BuzzDocument;
  readonly insights: BuzzDocument["insights"];
  readonly domainSummary: BuzzDomainSummary;
  readonly renderOutline: FigmaRenderOutline<BuzzRenderRole>;
};

/** Create a buzz render plan with explicit template render units. */
export function createBuzzRenderPlan(document: BuzzDocument): BuzzRenderPlan {
  const renderOutline = createFigmaRenderOutline(document.canvas.nodeChanges, BUZZ_RENDER_ROLES);
  if (renderOutline.entries.length === 0) {
    throw new Error("Buzz render plan requires at least one template render unit");
  }
  return {
    kind: "buzz",
    document,
    insights: document.insights,
    domainSummary: createBuzzDomainSummary(document),
    renderOutline,
  };
}
