/** @file Vector path data section. */
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render editable SVG path data for Kiwi VECTOR nodes. */
export function VectorPathSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (getNodeType(node) !== "VECTOR") {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("VectorPathSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  const firstPath = node.vectorPaths?.[0];
  if (firstPath === undefined) {
    return null;
  }
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Vector path</div>
      <PropertyField label="Path data">
        <textarea
          style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
          value={firstPath.data ?? ""}
          onChange={(event) => updateNode(guid, (current) => ({
            ...current,
            vectorPaths: [{ ...firstPath, data: event.currentTarget.value }],
          }), "property-panel")}
        />
      </PropertyField>
    </section>
  );
}
