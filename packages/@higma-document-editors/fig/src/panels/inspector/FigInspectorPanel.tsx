/** @file Inspector tree panel for Kiwi Fig nodes. */

import { useMemo, useState, type CSSProperties } from "react";
import { CategoryLegend, InspectorTreePanel } from "@higma-editor-surfaces/controls/inspector";
import { guidToString } from "@higma-document-models/fig/domain";
import type { InspectorTreeNode } from "@higma-editor-kernel/core/inspector-types";
import { useFigEditor } from "../../context/FigEditorContext";
import {
  FIG_LEGEND_ORDER,
  FIG_NODE_CATEGORY_REGISTRY,
  figNodeToInspectorTree,
} from "../../inspector";

export type FigInspectorPanelProps = {
  readonly showHiddenNodes?: boolean;
  readonly highlightedNodeId?: string | null;
  readonly onNodeHighlight?: (nodeId: string | null) => void;
  readonly onNodeHover?: (nodeId: string | null) => void;
};

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  gap: 8,
  overflow: "hidden",
};

const treeWrapperStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const emptyStyle: CSSProperties = {
  padding: 16,
  textAlign: "center",
  color: "#64748b",
  font: "12px system-ui, sans-serif",
};

function requireActivePageRoot(rootNode: InspectorTreeNode | null): InspectorTreeNode {
  if (rootNode === null) {
    throw new Error("FigInspectorPanel requires an active CANVAS root");
  }
  return rootNode;
}

/** Render an inspector tree over the active Kiwi CANVAS. */
export function FigInspectorPanel({
  showHiddenNodes = false,
  highlightedNodeId: controlledHighlightedId,
  onNodeHighlight,
  onNodeHover,
}: FigInspectorPanelProps) {
  const { activePage, resources, selectedGuids, selectNodeGuid, context } = useFigEditor();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const treeRoot = useMemo<InspectorTreeNode | null>(() => {
    if (activePage === undefined) {
      return null;
    }
    if (activePage.guid === undefined) {
      throw new Error("FigInspectorPanel active CANVAS is missing guid");
    }
    return {
      id: guidToString(activePage.guid),
      name: activePage.name ?? "CANVAS",
      nodeType: "CANVAS",
      width: 0,
      height: 0,
      opacity: activePage.opacity ?? 1,
      visible: activePage.visible !== false,
      children: resources.childrenOf(activePage)
        .filter((child) => showHiddenNodes || child.visible !== false)
        .map((child) => figNodeToInspectorTree({
          root: child,
          childrenOf: resources.childrenOf,
          showHiddenNodes,
        })),
    };
  }, [activePage, resources, showHiddenNodes]);
  if (treeRoot === null) {
    return <div style={emptyStyle}>No page selected</div>;
  }
  const highlightedNodeId = controlledHighlightedId ?? (selectedGuids[0] === undefined ? null : guidToString(selectedGuids[0]));
  const handleNodeHover = (nodeId: string | null): void => {
    setHoveredId(nodeId);
    onNodeHover?.(nodeId);
  };
  const handleNodeClick = (nodeId: string): void => {
    if (onNodeHighlight !== undefined) {
      onNodeHighlight(highlightedNodeId === nodeId ? null : nodeId);
      return;
    }
    const node = context.document.nodesByGuid.get(nodeId);
    if (node?.guid === undefined) {
      throw new Error(`FigInspectorPanel: node ${nodeId} is not present in the Kiwi document`);
    }
    selectNodeGuid(node.guid);
  };
  return (
    <div style={containerStyle}>
      <CategoryLegend registry={FIG_NODE_CATEGORY_REGISTRY} order={FIG_LEGEND_ORDER} />
      <div style={treeWrapperStyle}>
        <InspectorTreePanel
          rootNode={requireActivePageRoot(treeRoot)}
          registry={FIG_NODE_CATEGORY_REGISTRY}
          highlightedNodeId={highlightedNodeId}
          hoveredNodeId={hoveredId}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          showHiddenNodes={showHiddenNodes}
        />
      </div>
    </div>
  );
}
