/**
 * @file Inspector overlay designed to be composed INSIDE an EditorCanvas.
 *
 * Unlike InspectorView — which carries its own pan/zoom viewport — this
 * component renders raw SVG in the host canvas's page coordinate system
 * and delegates all viewport concerns (pan, zoom, rulers) to the host.
 *
 * Intended placement: directly inside EditorCanvas children, so the
 * overlay shares the same transform as the rendered document. Interaction
 * (hover / click) is reported via callbacks so the host editor can thread
 * it into its own selection or inspection state.
 */
import { useMemo, type MouseEventHandler } from "react";
import type {
  InspectorBoxInfo,
  NodeCategoryRegistry,
} from "@higma-editor-kernel/core/inspector-types";
import {
  affineToSvgTransform,
  resolveNodeColor,
} from "@higma-editor-kernel/core/inspector-types";

export type InspectorCanvasOverlayProps = {
  readonly boxes: readonly InspectorBoxInfo[];
  readonly registry: NodeCategoryRegistry;
  readonly highlightedNodeId?: string | null;
  readonly hoveredNodeId?: string | null;
  readonly onNodeHover?: (nodeId: string | null) => void;
  readonly onNodeClick?: (nodeId: string) => void;
  /**
   * Whether the overlay intercepts pointer events.
   *
   * When false (default), rects are non-interactive so the host editor's
   * own hit areas handle clicks. Set to true when the overlay is the
   * intended click target (e.g. a pure "inspect" mode with editing
   * suspended).
   */
  readonly interactive?: boolean;
};

const nonInteractiveRectStyle: React.CSSProperties = {
  pointerEvents: "none",
};

const interactiveRectStyle: React.CSSProperties = {
  cursor: "pointer",
  pointerEvents: "all",
};

function requireResolvedNodeColor(colorMap: ReadonlyMap<string, string>, nodeType: string): string {
  const color = colorMap.get(nodeType);
  if (color === undefined) {
    throw new Error(`InspectorCanvasOverlay missing resolved category color for node type "${nodeType}"`);
  }
  return color;
}

function overlayClickHandler(
  interactive: boolean,
  nodeId: string,
  onNodeClick: ((nodeId: string) => void) | undefined,
): MouseEventHandler<SVGRectElement> | undefined {
  if (!interactive) {
    return undefined;
  }
  return (event) => {
    event.stopPropagation();
    onNodeClick?.(nodeId);
  };
}

/**
 * Pure SVG bounding-box overlay for the host EditorCanvas page space.
 *
 * Emits one `<g>` containing one `<rect>` per node. Stroke is drawn with
 * `vectorEffect="non-scaling-stroke"` so zoom does not thicken outlines.
 */
export function InspectorCanvasOverlay({
  boxes,
  registry,
  highlightedNodeId = null,
  hoveredNodeId = null,
  onNodeHover,
  onNodeClick,
  interactive = false,
}: InspectorCanvasOverlayProps) {
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const box of boxes) {
      if (!map.has(box.nodeType)) {
        map.set(box.nodeType, resolveNodeColor(registry, box.nodeType));
      }
    }
    return map;
  }, [boxes, registry]);

  const rectStyle = interactive ? interactiveRectStyle : nonInteractiveRectStyle;

  return (
    <g data-inspector-overlay="true">
      {boxes.map((box) => {
        const color = requireResolvedNodeColor(colorMap, box.nodeType);
        const isHighlighted = box.nodeId === highlightedNodeId;
        const isHovered = box.nodeId === hoveredNodeId;

        const fillOpacity = isHighlighted ? 0.2 : isHovered ? 0.13 : 0.03;
        const strokeWidth = isHighlighted ? 2 : isHovered ? 1.5 : 0.5;

        return (
          <rect
            key={box.nodeId}
            x={0}
            y={0}
            width={box.width}
            height={box.height}
            transform={affineToSvgTransform(box.transform)}
            fill={color}
            fillOpacity={fillOpacity}
            stroke={color}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            style={rectStyle}
            onPointerEnter={interactive ? () => onNodeHover?.(box.nodeId) : undefined}
            onPointerLeave={interactive ? () => onNodeHover?.(null) : undefined}
            onClick={overlayClickHandler(interactive, box.nodeId, onNodeClick)}
          />
        );
      })}
    </g>
  );
}
