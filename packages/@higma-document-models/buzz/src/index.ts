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

export type BuzzDomainSummary = {
  readonly slideGridCount: number;
  readonly slideRowCount: number;
  readonly symbolCount: number;
  readonly vectorCount: number;
  readonly booleanOperationCount: number;
  readonly templateNodeCount: number;
};

export const BUZZ_DOCUMENT_PROFILE: BuzzDocumentProfile = {
  name: "buzz",
  magic: "fig-buzz",
  extension: ".buzz",
  domain: "template",
};

function nodeTypeCount(document: BuzzDocument, nodeType: string): number {
  return document.summary.nodeTypes.get(nodeType) ?? 0;
}

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

/** Summarize template/social-specific node families in a buzz document. */
export function createBuzzDomainSummary(document: BuzzDocument): BuzzDomainSummary {
  const slideGridCount = nodeTypeCount(document, "SLIDE_GRID");
  const slideRowCount = nodeTypeCount(document, "SLIDE_ROW");
  const symbolCount = nodeTypeCount(document, "SYMBOL");
  const vectorCount = nodeTypeCount(document, "VECTOR");
  const booleanOperationCount = nodeTypeCount(document, "BOOLEAN_OPERATION");
  return {
    slideGridCount,
    slideRowCount,
    symbolCount,
    vectorCount,
    booleanOperationCount,
    templateNodeCount: slideGridCount + slideRowCount + symbolCount + vectorCount + booleanOperationCount,
  };
}
