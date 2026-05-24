/** @file Shared bounds operations for editor viewport and root-surface layout. */

export type LayoutBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Resolve the right edge of a layout bounds rectangle. */
export function layoutBoundsRight(bounds: LayoutBounds): number {
  return bounds.x + bounds.width;
}

/** Resolve the bottom edge of a layout bounds rectangle. */
export function layoutBoundsBottom(bounds: LayoutBounds): number {
  return bounds.y + bounds.height;
}

/** Return true when two layout bounds overlap or touch at an edge. */
export function layoutBoundsTouchOrOverlap(left: LayoutBounds, right: LayoutBounds): boolean {
  return layoutBoundsRight(left) >= right.x
    && left.x <= layoutBoundsRight(right)
    && layoutBoundsBottom(left) >= right.y
    && left.y <= layoutBoundsBottom(right);
}

/** Resolve the positive-area intersection for render-surface clipping. */
export function resolveLayoutBoundsIntersection(
  left: LayoutBounds,
  right: LayoutBounds,
): LayoutBounds | undefined {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maxX = Math.min(layoutBoundsRight(left), layoutBoundsRight(right));
  const maxY = Math.min(layoutBoundsBottom(left), layoutBoundsBottom(right));
  if (maxX <= x || maxY <= y) {
    return undefined;
  }
  return { x, y, width: maxX - x, height: maxY - y };
}
