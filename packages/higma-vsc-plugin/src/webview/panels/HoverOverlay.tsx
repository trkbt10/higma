/**
 * @file Selection / hover bounding box rendered over the rendered fig
 * canvas.
 *
 * The overlay is positioned in *page-bounds* coordinate space (the
 * same space the renderer's viewBox uses), then scaled by the active
 * zoom. Coordinates are translated by `bounds.x / bounds.y` so a node
 * at world (50, 50) draws at (50 - bounds.x, 50 - bounds.y) inside
 * the canvas, regardless of which corner of page-space the canvas
 * starts at.
 *
 * The cursor tooltip lives outside the scaled inner stage so that
 * `transform: scale(zoom)` does not shrink the text — it is mounted
 * by `FigViewer` as a sibling of the stage and given absolute
 * cursor-relative coordinates in screen pixels.
 */

import type { NodeBounds } from "../geometry/node-bounds";
import type { PageBounds } from "../page-bounds";

type Props = {
  readonly pageBounds: PageBounds;
  readonly zoom: number;
  readonly hovered: NodeBounds | null;
  readonly selected: NodeBounds | null;
};

function rectStyle(node: NodeBounds, page: PageBounds, zoom: number): React.CSSProperties {
  return {
    position: "absolute",
    left: (node.x - page.x) * zoom,
    top: (node.y - page.y) * zoom,
    width: node.width * zoom,
    height: node.height * zoom,
    pointerEvents: "none",
  };
}






export function HoverOverlay({ pageBounds, zoom, hovered, selected }: Props) {
  return (
    <>
      {hovered && hovered.id !== selected?.id && (
        <div
          className="higma-fig-overlay higma-fig-overlay--hover"
          style={rectStyle(hovered, pageBounds, zoom)}
          data-testid="fig-overlay-hover"
        />
      )}
      {selected && (
        <div
          className="higma-fig-overlay higma-fig-overlay--selected"
          style={rectStyle(selected, pageBounds, zoom)}
          data-testid="fig-overlay-selected"
        />
      )}
    </>
  );
}

type TooltipProps = {
  readonly node: NodeBounds;
  /** Cursor position in viewport CSS pixels. */
  readonly cursor: { readonly x: number; readonly y: number };
};

/**
 * Cursor-anchored size readout shown while hovering a node on the
 * canvas. Mounted at document level so it can escape the canvas
 * scroll container without being clipped.
 */
export function HoverTooltip({ node, cursor }: TooltipProps) {
  const w = formatDimension(node.width);
  const h = formatDimension(node.height);
  const offset = 14;
  return (
    <div
      className="higma-fig-overlay-tooltip"
      style={{
        position: "fixed",
        left: cursor.x + offset,
        top: cursor.y + offset,
        pointerEvents: "none",
      }}
      data-testid="fig-overlay-tooltip"
    >
      <span>{w}</span>
      <span className="higma-fig-overlay-tooltip__sep">×</span>
      <span>{h}</span>
    </div>
  );
}

function formatDimension(value: number): string {
  // Match Figma's display: trim sub-pixel noise on integer dims, but
  // preserve precision when it is meaningful (common for transformed
  // text or rotated rects).
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return `${Math.round(value)}`;
  }
  return value.toFixed(2);
}
