/**
 * @file Product-free fig-family document fact loading.
 */

import { decodeFigmaKiwiCanvas, type FigmaKiwiCanvas } from "@higma-figma-runtime/kiwi-canvas";
import { summarizeFigmaNodes, type FigmaNodeSummary } from "@higma-figma-runtime/node-summary";
import type { FigSchemaProfile } from "@higma-figma-schema/profiles";

export type FigmaDocumentFacts = {
  readonly canvas: FigmaKiwiCanvas;
  readonly summary: FigmaNodeSummary;
};

/** Load decoded canvas facts and validate that they match the requested product profile. */
export async function loadFigmaDocumentFacts(
  data: Uint8Array,
  profile: FigSchemaProfile,
): Promise<FigmaDocumentFacts> {
  const canvas = await decodeFigmaKiwiCanvas(data);
  return createFigmaDocumentFacts(canvas, profile);
}

/** Create document facts from an already decoded fig-family canvas. */
export function createFigmaDocumentFacts(
  canvas: FigmaKiwiCanvas,
  profile: FigSchemaProfile,
): FigmaDocumentFacts {
  if (canvas.header.magic !== profile.magic) {
    throw new Error(`Expected ${profile.name} canvas magic ${profile.magic}, got ${canvas.header.magic}`);
  }
  const summary = summarizeFigmaNodes(canvas.nodeChanges);
  return {
    canvas,
    summary,
  };
}
