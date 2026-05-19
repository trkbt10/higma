/** @file Size property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { fieldGridStyle, inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render editable size controls for nodes that carry Kiwi size. */
export function SizeSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.guid === undefined) {
    throw new Error("SizeSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  if (node.size === undefined) {
    return null;
  }
  const size = node.size;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Size</div>
      <div style={fieldGridStyle}>
        <PropertyField label="W">
          <input
            style={inputStyle}
            type="number"
            value={size.x}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              size: { x: Number(event.currentTarget.value), y: current.size?.y ?? size.y },
            }), "property-panel")}
          />
        </PropertyField>
        <PropertyField label="H">
          <input
            style={inputStyle}
            type="number"
            value={size.y}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              size: { x: current.size?.x ?? size.x, y: Number(event.currentTarget.value) },
            }), "property-panel")}
          />
        </PropertyField>
      </div>
    </section>
  );
}
