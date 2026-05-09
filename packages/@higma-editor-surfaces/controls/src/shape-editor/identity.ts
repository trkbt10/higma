/**
 * @file Generic shape identity operations
 *
 * ID-related operations for shapes, independent of PPTX types.
 */

import type { ShapeNode, IdentifiableShape } from "./types";
import { isIdentifiable } from "./types";

/**
 * Type-guard: does this shape carry an `id` (i.e. has `nonVisual.id`)?
 *
 * Wraps the `isIdentifiable` predicate from `./types` so callers in
 * shape-editor consume one explicit name instead of importing a generic
 * `isIdentifiable` from a different module. Behaviour is identical.
 */
export function hasShapeId(shape: ShapeNode): shape is IdentifiableShape {
  return isIdentifiable(shape);
}

/**
 * Get shape ID.
 * Returns undefined for shapes without nonVisual.
 */
export function getShapeId(shape: ShapeNode): string | undefined {
  if (isIdentifiable(shape)) {
    return shape.nonVisual.id;
  }
  return undefined;
}
