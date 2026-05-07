/**
 * @file Fig parser normalization API backed by fig-family runtime SoT.
 */

import {
  denormaliseFigFamilyNodeForEncode,
  normaliseFigFamilyNodeChanges,
} from "@higma-figma-runtime/roundtrip";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

/** Walk decoded node changes and normalise Kiwi enum values into domain strings. */
export function normaliseNodeChanges(rawNodes: readonly unknown[]): readonly FigNode[] {
  return normaliseFigFamilyNodeChanges<FigNode>(rawNodes);
}

/** Coerce raw decoded blobs to the typed array. */
export function asBlobArray(raw: unknown): readonly FigBlob[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as readonly FigBlob[];
}

/** Clone a node and convert domain string enums back to Kiwi enum values for encoding. */
export function denormaliseNodeForEncode(node: FigNode): Record<string, unknown> {
  return denormaliseFigFamilyNodeForEncode(node);
}
