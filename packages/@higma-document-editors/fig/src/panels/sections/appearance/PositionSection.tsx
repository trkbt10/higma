/** @file Position property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { fieldGridStyle, inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { readTransformPosition, setTransformPosition } from "./transform-matrix";

/** Render position controls backed by the Kiwi transform matrix. */
export function PositionSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.guid === undefined) {
    throw new Error("PositionSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  const position = readTransformPosition(node.transform);
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Position</div>
      <div style={fieldGridStyle}>
        <PropertyField label="X">
          <input
            style={inputStyle}
            type="number"
            value={position.x}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              transform: setTransformPosition(current.transform, Number(event.currentTarget.value), readTransformPosition(current.transform).y),
            }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
          />
        </PropertyField>
        <PropertyField label="Y">
          <input
            style={inputStyle}
            type="number"
            value={position.y}
            onChange={(event) => updateNode(guid, (current) => ({
              ...current,
              transform: setTransformPosition(current.transform, readTransformPosition(current.transform).x, Number(event.currentTarget.value)),
            }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
          />
        </PropertyField>
      </div>
    </section>
  );
}
