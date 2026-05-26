/** @file Canvas extents derived from renderer SceneGraph node bounds. */
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { layoutBoundsBottom, layoutBoundsRight } from "./layout-bounds";

export type FigCanvasBounds = {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

const CANVAS_PADDING = 160;
const MIN_CANVAS_SIZE = 320;

/** Compute an infinite-canvas surface that contains every rendered node bound. */
export function computeCanvasBoundsFromSceneGraphNodeBounds(
  bounds: readonly SceneGraphNodeBounds[],
): FigCanvasBounds {
  if (bounds.length === 0) {
    return {
      width: MIN_CANVAS_SIZE,
      height: MIN_CANVAS_SIZE,
      offsetX: 0,
      offsetY: 0,
    };
  }
  const maxX = Math.max(...bounds.map((item) => layoutBoundsRight(item.aabb)));
  const maxY = Math.max(...bounds.map((item) => layoutBoundsBottom(item.aabb)));
  return {
    width: Math.max(maxX + CANVAS_PADDING, MIN_CANVAS_SIZE),
    height: Math.max(maxY + CANVAS_PADDING, MIN_CANVAS_SIZE),
    offsetX: 0,
    offsetY: 0,
  };
}
