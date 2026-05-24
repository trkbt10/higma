/** @file Rotation property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { inputStyle, PropertyField, sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { readTransformRotation, setTransformRotation } from "./transform-matrix";

/** Render rotation controls backed by the Kiwi transform matrix. */
export function RotationSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (node.guid === undefined) {
    throw new Error("RotationSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Rotation</div>
      <PropertyField label="Degrees">
        <input
          style={inputStyle}
          type="number"
          value={readTransformRotation(node.transform)}
          onChange={(event) => updateNode(guid, (current) => ({
            ...current,
            transform: setTransformRotation(current.transform, Number(event.currentTarget.value)),
          }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        />
      </PropertyField>
    </section>
  );
}
