/** @file Canvas extents derived from Kiwi node bounds. */
import type { NodeBounds } from "../interaction/bounds";

export type FigCanvasBounds = {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

const CANVAS_PADDING = 160;
const MIN_CANVAS_SIZE = 320;

/** Compute an infinite-canvas surface that contains every node bound. */
export function computeCanvasBoundsFromNodeBounds(bounds: readonly NodeBounds[]): FigCanvasBounds {
  if (bounds.length === 0) {
    return {
      width: MIN_CANVAS_SIZE,
      height: MIN_CANVAS_SIZE,
      offsetX: 0,
      offsetY: 0,
    };
  }
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  return {
    width: Math.max(maxX + CANVAS_PADDING, MIN_CANVAS_SIZE),
    height: Math.max(maxY + CANVAS_PADDING, MIN_CANVAS_SIZE),
    offsetX: 0,
    offsetY: 0,
  };
}
