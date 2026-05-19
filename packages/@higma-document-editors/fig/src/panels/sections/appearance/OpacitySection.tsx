/** @file Opacity and visibility property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { fieldGridStyle, inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render opacity and visibility controls for a Kiwi node. */
export function OpacitySection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.guid === undefined) {
    throw new Error("OpacitySection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Appearance</div>
      <div style={fieldGridStyle}>
        <PropertyField label="Opacity">
          <input
            style={inputStyle}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={node.opacity ?? 1}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              opacity: Number(event.currentTarget.value),
            }), "property-panel")}
          />
        </PropertyField>
        <PropertyField label="Visible">
          <input
            type="checkbox"
            checked={node.visible !== false}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              visible: event.currentTarget.checked,
            }), "property-panel")}
          />
        </PropertyField>
      </div>
    </section>
  );
}
