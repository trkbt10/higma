/**
 * @file Selection / hover bounding box rendered over the rendered fig
 * canvas.
 *
 * Overlay rectangles are positioned in *surface-px* (the same coords
 * the canvas DOM lives in) by applying the viewport transform to the
 * world-space node bounds: `surface = world * scale + translate`.
 * That mirrors the inverse the renderer uses when sampling the world
 * window for paint, so a hover box always lands exactly on the node
 * the renderer drew — regardless of pan or zoom.
 *
 * The cursor tooltip is mounted by `FigViewer` as a sibling of the
 * stage at fixed-position client px so it never inherits any canvas
 * styling that could clip or distort it.
 */

import type { NodeBounds } from "../geometry/node-bounds";
import type { ViewportTransform } from "../FigViewer";

type Props = {
  readonly viewport: ViewportTransform;
  readonly hovered: NodeBounds | null;
  readonly selected: NodeBounds | null;
};

function rectStyle(node: NodeBounds, viewport: ViewportTransform): React.CSSProperties {
  return {
    position: "absolute",
    left: node.x * viewport.scale + viewport.translateX,
    top: node.y * viewport.scale + viewport.translateY,
    width: node.width * viewport.scale,
    height: node.height * viewport.scale,
    pointerEvents: "none",
  };
}


export function HoverOverlay({ viewport, hovered, selected }: Props) {
  return (
    <>
      {hovered && hovered.id !== selected?.id && (
        <div
          className="higma-fig-overlay higma-fig-overlay--hover"
          style={rectStyle(hovered, viewport)}
          data-testid="fig-overlay-hover"
        />
      )}
      {selected && (
        <div
          className="higma-fig-overlay higma-fig-overlay--selected"
          style={rectStyle(selected, viewport)}
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
