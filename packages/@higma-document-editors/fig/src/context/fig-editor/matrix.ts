/**
 * @file Matrix transformation utilities
 *
 * Shared SoT for 2x3 affine transform matrix operations used by both
 * canvas bounds calculation and reducer node geometry updates.
 *
 * Figma uses 2x3 affine transform matrices. The composition is standard
 * 2x3 affine matrix multiplication:
 *   [a' b' tx']   [a1 b1 tx1]   [a2 b2 tx2]
 *   [c' d' ty'] = [c1 d1 ty1] * [c2 d2 ty2]
 *   [0  0   1 ]   [ 0  0   1]   [ 0  0   1]
 */

import type { FigMatrix } from "@higma-document-models/fig/types";

/** Identity matrix — no transformation. */
export const IDENTITY_MATRIX: FigMatrix = {
  m00: 1, m01: 0, m02: 0,
  m10: 0, m11: 1, m12: 0,
};

/**
 * Compose two 2x3 affine transform matrices.
 *
 * Returns M_parent * M_child, which represents the child's transform
 * in the parent's coordinate space.
 */
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
