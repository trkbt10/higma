/**
 * @file Test helpers — fake FigNode constructors used by colocated specs.
 *
 * Test specs need very partial FigNode shapes (just type + guid +
 * a handful of fields). FigNode itself is a wide interface, so the
 * helper applies a single typed cast here and call sites stay free of
 * `as unknown as` chains (which the lint forbids).
 */
import type { FigFontName, FigMatrix, FigNode, FigPaint, FigValueWithUnits } from "@higma-document-models/fig/types";

export type FakeFigNodeInput = {
  readonly type: { readonly value: number; readonly name: string };
  readonly guid: { readonly sessionID: number; readonly localID: number };
  readonly name?: string;
  readonly characters?: string;
  readonly size?: { readonly x: number; readonly y: number };
  readonly children?: readonly FigNode[];
  readonly fillPaints?: readonly FigPaint[];
  readonly strokePaints?: readonly FigPaint[];
  readonly backgroundPaints?: readonly FigPaint[];
  readonly styleType?: { readonly value: number; readonly name: string };
  readonly styleIdForFill?: { readonly guid: { readonly sessionID: number; readonly localID: number } };
  readonly fontName?: FigFontName;
  readonly fontSize?: number;
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
  readonly transform?: FigMatrix;
  readonly visible?: boolean;
};

/** Build a fake FigNode for tests. */
export function fakeFigNode(partial: FakeFigNodeInput): FigNode {
  return partial as FigNode;
}
