/** @file Rotation math for editor selection bounds. */
import type { FigMatrix } from "@higma-document-models/fig/types";

/** Extract clockwise degrees from a 2x3 affine transform. */
export function extractRotationDeg(transform: FigMatrix): number {
  return Math.atan2(transform.m10, transform.m00) * (180 / Math.PI);
}

/** Resolve the visual top-left before rotation around the node center. */
export function computePreRotationTopLeft(
  transform: FigMatrix,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const centerX = transform.m00 * (width / 2) + transform.m01 * (height / 2) + transform.m02;
  const centerY = transform.m10 * (width / 2) + transform.m11 * (height / 2) + transform.m12;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
  };
}
