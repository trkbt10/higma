/** @file Presentation labels for Kiwi layer rows. */
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

export type FigLayerNodePresentation = {
  readonly typeName: string;
  readonly label: string;
};

/** Resolve a compact layer-row label from the Kiwi node fields. */
export function getLayerNodePresentation(node: FigNode): FigLayerNodePresentation {
  const typeName = getNodeType(node);
  return {
    typeName,
    label: node.name ?? typeName,
  };
}
