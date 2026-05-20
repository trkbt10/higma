/** @file Transform field operations for Kiwi nodes. */
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigMatrix } from "@higma-document-models/fig/types";
import { extractRotationDeg } from "../../../context/fig-editor/rotation";

/** Return transform translation X/Y with schema identity values applied. */
export function readTransformPosition(transform: FigMatrix | undefined): { readonly x: number; readonly y: number } {
  const matrix = readKiwiTransform(transform);
  return { x: matrix.m02, y: matrix.m12 };
}

/** Return transform rotation in degrees. */
export function readTransformRotation(transform: FigMatrix | undefined): number {
  return extractRotationDeg(readKiwiTransform(transform));
}

/** Set transform translation while preserving current affine basis. */
export function setTransformPosition(
  transform: FigMatrix | undefined,
  x: number,
  y: number,
): FigMatrix {
  return { ...readKiwiTransform(transform), m02: x, m12: y };
}

/** Set transform rotation around the node origin while preserving translation. */
export function setTransformRotation(transform: FigMatrix | undefined, degrees: number): FigMatrix {
  const matrix = readKiwiTransform(transform);
  const radians = (degrees * Math.PI) / 180;
  return {
    ...matrix,
    m00: Math.cos(radians),
    m01: -Math.sin(radians),
    m10: Math.sin(radians),
    m11: Math.cos(radians),
  };
}
