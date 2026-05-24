/** @file Auto layout fields for Kiwi FRAME/SYMBOL nodes. */
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render editable auto-layout controls for Kiwi stack fields. */
export function AutoLayoutSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.stackMode === undefined) {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("AutoLayoutSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Auto layout</div>
      <PropertyField label="Spacing">
        <input
          style={inputStyle}
          type="number"
          value={node.stackSpacing ?? 0}
          onChange={(event) => updateNode(guid, (current) => ({
            ...current,
            stackSpacing: Number(event.currentTarget.value),
          }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        />
      </PropertyField>
    </section>
  );
}
