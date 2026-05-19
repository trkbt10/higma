/** @file Inspector overlay for Kiwi canvas nodes. */

import { useMemo, useState } from "react";
import type { NodeCategoryRegistry } from "@higma-editor-kernel/core/inspector-types";
import { InspectorCanvasOverlay } from "@higma-editor-surfaces/controls/inspector";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { useFigEditor } from "../context/FigEditorContext";
import { FIG_NODE_CATEGORY_REGISTRY } from "./fig-node-categories";
import { collectFigInspectorBoxes } from "./fig-inspector-projection";

export type FigInspectorOverlayProps = {
  readonly registry?: NodeCategoryRegistry;
  readonly showHiddenNodes?: boolean;
  readonly interactive?: boolean;
  readonly onNodeClick?: (guid: FigGuid) => void;
};

/** Render bounding boxes for the active Kiwi CANVAS subtree. */
export function FigInspectorOverlay({
  registry = FIG_NODE_CATEGORY_REGISTRY,
  showHiddenNodes = false,
  interactive = false,
  onNodeClick,
}: FigInspectorOverlayProps) {
  const { activePage, resources, selectedGuids, context } = useFigEditor();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const boxes = useMemo(() => {
    if (activePage === undefined) {
      return [];
    }
    return resources.childrenOf(activePage).flatMap((node) => collectFigInspectorBoxes({
      root: node,
      childrenOf: resources.childrenOf,
      showHiddenNodes,
    }));
  }, [activePage, resources, showHiddenNodes]);
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
