/** @file Affine matrix operations for Kiwi node transforms. */
import type { FigMatrix } from "@higma-document-models/fig/types";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";

/** Translate a Kiwi node transform while preserving rotation and scale. */
export function translateTransform(transform: FigMatrix | undefined, dx: number, dy: number): FigMatrix {
  const base = readKiwiTransform(transform);
  return {
    ...base,
    m02: base.m02 + dx,
    m12: base.m12 + dy,
  };
}
