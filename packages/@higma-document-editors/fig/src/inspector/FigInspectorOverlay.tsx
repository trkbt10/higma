/** @file Inspector overlay for renderer-derived Fig canvas node bounds. */

import { useMemo, useState } from "react";
import type { NodeCategoryRegistry } from "@higma-editor-kernel/core/inspector-types";
import { InspectorCanvasOverlay } from "@higma-editor-surfaces/controls/inspector";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { useFigEditor, useFigEditorCanvasViewport } from "../context/FigEditorContext";
import { FIG_NODE_CATEGORY_REGISTRY } from "./fig-node-categories";
import { collectFigInspectorBoxesFromRenderedNodeBounds } from "./fig-inspector-rendered-boxes";

export type FigInspectorOverlayProps = {
  readonly registry?: NodeCategoryRegistry;
  readonly showHiddenNodes?: boolean;
  readonly interactive?: boolean;
  readonly onNodeClick?: (guid: FigGuid) => void;
};

/** Render bounding boxes from the same SceneGraph bounds consumed by the editor canvas. */
export function FigInspectorOverlay({
  registry = FIG_NODE_CATEGORY_REGISTRY,
  showHiddenNodes = false,
  interactive = false,
  onNodeClick,
}: FigInspectorOverlayProps) {
  const { selectedGuids, context } = useFigEditor();
  const canvasViewport = useFigEditorCanvasViewport();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const boxes = useMemo(() => {
    if (canvasViewport === undefined) {
      return [];
    }
    if (showHiddenNodes) {
      throw new Error("FigInspectorOverlay showHiddenNodes requires renderer-derived hidden-node bounds");
    }
    return collectFigInspectorBoxesFromRenderedNodeBounds({
      document: context.document,
      bounds: canvasViewport.renderedNodeBounds,
    });
  }, [canvasViewport, context.document, showHiddenNodes]);
  const highlightedNodeId = selectedGuids[0] === undefined ? null : guidToString(selectedGuids[0]);
  return (
    <InspectorCanvasOverlay
      boxes={boxes}
      registry={registry}
      highlightedNodeId={highlightedNodeId}
      hoveredNodeId={hoveredId}
      onNodeHover={setHoveredId}
      onNodeClick={(nodeId) => {
        const node = context.document.nodesByGuid.get(nodeId);
        if (node?.guid === undefined) {
          throw new Error(`FigInspectorOverlay: node ${nodeId} is not present in the Kiwi document`);
        }
        onNodeClick?.(node.guid);
      }}
      interactive={interactive}
    />
  );
}
