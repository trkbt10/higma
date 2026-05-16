/**
 * @file Transform matrix helpers shared by the position / size / rotation
 * section adapters and the alignment adapter.
 *
 * Keeps the matrix-update logic in one place so each section adapter stays
 * focused on translating UI intents to property mutations.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigMatrix } from "@higma-document-models/fig/types";
import { extractRotationDeg } from "../../../context/fig-editor/rotation";

/**
 * Rebuild a rotation matrix from a pre-rotation top-left and the node's
 * current rotation. Used by both position editing and parent alignment.
 */
export function rebuildTransformFromTopLeft(
  node: FigDesignNode,
  topLeft: { readonly x: number; readonly y: number },
): FigMatrix {
  const currentAngle = extractRotationDeg(node.transform);
  const radians = (currentAngle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = node.size.x / 2;
  const halfH = node.size.y / 2;
  const newCx = topLeft.x + halfW;
  const newCy = topLeft.y + halfH;
  return {
    m00: cos,
    m01: -sin,
    m02: newCx - cos * halfW + sin * halfH,
    m10: sin,
    m11: cos,
    m12: newCy - sin * halfW - cos * halfH,
  };
}

/** Mirror the matrix about the node's local vertical axis (x = width/2). */
export function flipMatrixHorizontalLocal(m: FigMatrix, width: number): FigMatrix {
  return {
    m00: -m.m00,
    m01: m.m01,
    m02: m.m02 + m.m00 * width,
    m10: -m.m10,
    m11: m.m11,
    m12: m.m12 + m.m10 * width,
  };
}

/** Mirror the matrix about the node's local horizontal axis (y = height/2). */
export function flipMatrixVerticalLocal(m: FigMatrix, height: number): FigMatrix {
  return {
    m00: m.m00,
    m01: -m.m01,
    m02: m.m02 + m.m01 * height,
    m10: m.m10,
    m11: -m.m11,
    m12: m.m12 + m.m11 * height,
  };
}
