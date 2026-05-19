/** @file Corner radius property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { readUniformCornerRadius } from "./corner-radius-domain";

/** Render the editable uniform corner radius field. */
export function CornerRadiusSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.guid === undefined) {
    throw new Error("CornerRadiusSection requires a Kiwi node guid");
  }
  const radius = readUniformCornerRadius(node);
  if (radius === undefined) {
    return null;
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Corners</div>
      <PropertyField label="Radius">
        <input
          style={inputStyle}
          type="number"
          min={0}
          value={radius}
          onChange={(event) => updateNode(guid, (current) => ({
            ...current,
            cornerRadius: Number(event.currentTarget.value),
            rectangleCornerRadii: undefined,
          }), "property-panel")}
        />
      </PropertyField>
    </section>
  );
}
