/** @file Fig parser node codec API backed by fig-family runtime SoT. */

import {
  encodeFigFamilyNodeChange,
  readFigFamilyNodeChanges,
} from "@higma-figma-runtime/roundtrip";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

/**
 * Decode raw fig-family node changes into typed Kiwi FigNode values.
 */
export function readNodeChanges(rawNodes: readonly unknown[]): readonly FigNode[] {
  return readFigFamilyNodeChanges<FigNode>(rawNodes);
}

/** Coerce raw decoded blobs to the typed array. */
export function asBlobArray(raw: unknown): readonly FigBlob[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as readonly FigBlob[];
}

/**
 * Encode one typed FigNode back to the fig-family Kiwi node shape.
 */
export function encodeNodeForKiwi(node: FigNode): Record<string, unknown> {
  return encodeFigFamilyNodeChange(node);
}
