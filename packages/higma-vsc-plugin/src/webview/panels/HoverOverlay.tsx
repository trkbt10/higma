/**
 * @file Selection / hover bounding boxes rendered over the rendered fig
 * canvas.
 *
 * Overlay rectangles are positioned in *surface-px* (the same coords
 * the canvas DOM lives in) by applying the viewport transform to the
 * world-space node bounds: `surface = world * scale + translate`.
 * That mirrors the inverse the renderer uses when sampling the world
 * window for paint, so a box always lands exactly on the node the
 * renderer drew — regardless of pan or zoom.
 *
 * Multiple selection: every member of the selection set draws a box.
 * The current "primary" — the last-clicked anchor — gets a slightly
 * stronger outline so the user has visual confirmation of where the
 * next shift-click will extend from. Non-primary members use the
 * standard selection outline.
 *
 * The cursor tooltip is mounted by `FigViewer` as a sibling of the
 * stage at fixed-position client px so it never inherits any canvas
 * styling that could clip or distort it.
 */

import type { NodeBounds } from "../geometry/node-bounds";
import type { WorldRect } from "../geometry/marquee";
import type { ViewportTransform } from "../FigViewer";

type Props = {
  readonly viewport: ViewportTransform;
  readonly hovered: NodeBounds | null;
  readonly selected: readonly NodeBounds[];
  readonly primaryId: string | null;
};

function selectionOverlayClassName(isPrimary: boolean): string {
  if (isPrimary) {
    return "higma-fig-overlay higma-fig-overlay--selected higma-fig-overlay--primary";
  }
  return "higma-fig-overlay higma-fig-overlay--selected";
}

function selectionOverlayTestId(isPrimary: boolean): string {
  if (isPrimary) {return "fig-overlay-selected";}
  return "fig-overlay-selected-secondary";
}

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

/** Render hover and selection boxes over the viewport. */
export function HoverOverlay({ viewport, hovered, selected, primaryId }: Props) {
  const selectedIds = new Set(selected.map((node) => node.id));
  const showHover = hovered && !selectedIds.has(hovered.id);
  return (
    <>
      {showHover && hovered && (
        <div
          className="higma-fig-overlay higma-fig-overlay--hover"
          style={rectStyle(hovered, viewport)}
          data-testid="fig-overlay-hover"
        />
      )}
      {selected.map((node) => {
        const isPrimary = node.id === primaryId;
        return (
          <div
            key={node.id}
            className={selectionOverlayClassName(isPrimary)}
            style={rectStyle(node, viewport)}
            data-testid={selectionOverlayTestId(isPrimary)}
          />
        );
      })}
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

type MarqueeOverlayProps = {
  readonly viewport: ViewportTransform;
  readonly rect: WorldRect;
};

/**
 * Translucent rectangle painted while the user drags a marquee on the
 * stage. Sits alongside the hover / selection boxes so the same
 * surface-px transform applies (`surface = world * scale + translate`).
 */
export function MarqueeOverlay({ viewport, rect }: MarqueeOverlayProps) {
  return (
    <div
      className="higma-fig-overlay higma-fig-overlay--marquee"
      style={{
        position: "absolute",
        left: rect.x * viewport.scale + viewport.translateX,
        top: rect.y * viewport.scale + viewport.translateY,
        width: rect.width * viewport.scale,
        height: rect.height * viewport.scale,
        pointerEvents: "none",
      }}
      data-testid="fig-overlay-marquee"
    />
  );
}
