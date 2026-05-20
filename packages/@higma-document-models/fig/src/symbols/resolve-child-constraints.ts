/**
 * @file Per-child constraint resolution.
 *
 * SymbolResolver needs to resolve a single child's
 * position and size when its parent INSTANCE is resized.
 *
 * This module centralises the common steps:
 *   1. Extract constraint values from horizontalConstraint / verticalConstraint
 *   2. Read transform (m02, m12) and size (x, y)
 *   3. Resolve both axes via resolveConstraintAxis
 *   4. Detect position / size changes
 */

import type { FigMatrix, FigVector, KiwiEnumValue } from "../types";
import { CONSTRAINT_TYPE_VALUES } from "../constants";
import { resolveConstraintAxis } from "./constraint-axis";

// =============================================================================
// Types
// =============================================================================

/** Result of resolving a single child's constraints on both axes. */
export type ChildConstraintResolution = {
  readonly posX: number;
  readonly posY: number;
  readonly dimX: number;
  readonly dimY: number;
  readonly posChanged: boolean;
  readonly sizeChanged: boolean;
};

// =============================================================================
// Local Routines
// =============================================================================

/**
 * Extract the numeric constraint value from a Kiwi constraint field.
 * An absent constraint is Kiwi's omitted-field encoding for MIN.
 */
export function getConstraintValue(constraintField: { readonly value?: unknown; readonly name?: unknown } | undefined): number {
  if (constraintField === undefined) {
    return CONSTRAINT_TYPE_VALUES.MIN;
  }
  if (typeof constraintField.value !== "number") {
    throw new Error("Constraint field must be a Kiwi enum value");
  }
  return constraintField.value;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve constraints for a single child node when its parent is resized.
 *
 * Requires transform and size because every non-MIN constraint needs a
 * concrete source rectangle.
 */
type ConstraintChild = {
  readonly horizontalConstraint?: KiwiEnumValue;
  readonly verticalConstraint?: KiwiEnumValue;
  readonly transform?: FigMatrix;
  readonly size?: FigVector;
  readonly [key: string]: unknown;
};

/** Resolve one constrained child rectangle from Kiwi constraint fields. */
export function resolveChildConstraints(
  child: ConstraintChild,
  parentOrigSize: { x: number; y: number },
  parentNewSize: { x: number; y: number },
): ChildConstraintResolution {
  const hVal = getConstraintValue(child.horizontalConstraint);
  const vVal = getConstraintValue(child.verticalConstraint);

  const transform = child.transform;
  const size = child.size;

  if (transform === undefined) {
    throw new Error("Constraint resolution requires child.transform");
  }
  if (size === undefined) {
    throw new Error("Constraint resolution requires child.size");
  }

  const origX = transform.m02 ?? 0;
  const origY = transform.m12 ?? 0;
  const origW = size.x;
  const origH = size.y;

  const hResult = resolveConstraintAxis({
    origPos: origX,
    origDim: origW,
    parentOrigDim: parentOrigSize.x,
    parentNewDim: parentNewSize.x,
    constraintValue: hVal,
  });
  const vResult = resolveConstraintAxis({
    origPos: origY,
    origDim: origH,
    parentOrigDim: parentOrigSize.y,
    parentNewDim: parentNewSize.y,
    constraintValue: vVal,
  });

  return {
    posX: hResult.pos,
    posY: vResult.pos,
    dimX: hResult.dim,
    dimY: vResult.dim,
    posChanged: hResult.pos !== origX || vResult.pos !== origY,
    sizeChanged: hResult.dim !== origW || vResult.dim !== origH,
  };
}
