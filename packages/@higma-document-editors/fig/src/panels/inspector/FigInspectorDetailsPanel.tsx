/** @file Inspector details panel for the selected Kiwi node. */
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { useFigEditor } from "../../context/FigEditorContext";
import { classifyFigNode } from "../../inspector";

/** Render structural node details. */
export function FigInspectorDetailsPanel() {
  const { primaryNode } = useFigEditor();
  if (primaryNode === undefined) {
    return <div style={{ padding: 12, color: "#64748b" }}>No selection</div>;
  }
  if (primaryNode.guid === undefined) {
    throw new Error("FigInspectorDetailsPanel selected node is missing guid");
  }
  return (
    <div style={{ padding: 12, display: "grid", gap: 6, font: "12px system-ui, sans-serif" }}>
      <div><strong>Name</strong> {primaryNode.name ?? "(unnamed)"}</div>
      <div><strong>Type</strong> {getNodeType(primaryNode)}</div>
      <div><strong>Category</strong> {classifyFigNode(primaryNode)}</div>
      <div><strong>GUID</strong> {guidToString(primaryNode.guid)}</div>
    </div>
  );
}
