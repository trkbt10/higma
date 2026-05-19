/** @file Affine matrix operations for Kiwi node transforms. */
import type { FigMatrix } from "@higma-document-models/fig/types";
import { IDENTITY_MATRIX } from "@higma-document-models/fig/matrix";

/** Compose parent and child 2x3 affine transforms. */
export function composeTransforms(parent: FigMatrix, child: FigMatrix): FigMatrix {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

/** Read a Kiwi transform, applying the schema identity values for omitted fields. */
export function readKiwiTransform(transform: FigMatrix | undefined): FigMatrix {
  if (transform === undefined) {
    return IDENTITY_MATRIX;
  }
  return {
    m00: transform.m00 ?? 1,
    m01: transform.m01 ?? 0,
    m02: transform.m02 ?? 0,
    m10: transform.m10 ?? 0,
    m11: transform.m11 ?? 1,
    m12: transform.m12 ?? 0,
  };
}

/** Translate a Kiwi node transform while preserving rotation and scale. */
export function translateTransform(transform: FigMatrix | undefined, dx: number, dy: number): FigMatrix {
  const base = readKiwiTransform(transform);
  return {
    ...base,
    m02: base.m02 + dx,
    m12: base.m12 + dy,
  };
}
