/**
 * @file Test helpers — fake FigNode constructors used by colocated specs.
 *
 * Test specs need very partial FigNode shapes (just type + guid +
 * a handful of fields). FigNode itself is a wide interface, so the
 * helper applies a single typed cast here and call sites stay free of
 * `as unknown as` chains (which the lint forbids).
 */
import type { FigNode } from "@higma-document-models/fig/types";

export type FakeFigNodeInput = {
  readonly type: { readonly value: number; readonly name: string };
  readonly guid: { readonly sessionID: number; readonly localID: number };
  readonly name?: string;
  readonly characters?: string;
  readonly size?: { readonly x: number; readonly y: number };
  readonly children?: readonly FigNode[];
};

/** Build a fake FigNode for tests. */
export function fakeFigNode(partial: FakeFigNodeInput): FigNode {
  return partial as FigNode;
}
