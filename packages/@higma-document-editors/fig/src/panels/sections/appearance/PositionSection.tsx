/** @file Position property section. */
import { PositionSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
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
      <PositionSectionView
        x={position.x}
        y={position.y}
        onChange={(field, value) => {
          switch (field) {
            case "x":
              updateNode(guid, (current) => ({
              ...current,
                transform: setTransformPosition(current.transform, value, readTransformPosition(current.transform).y),
              }), FIG_NODE_MUTATION_SOURCE.propertyPanel);
              return;
            case "y":
              updateNode(guid, (current) => ({
              ...current,
                transform: setTransformPosition(current.transform, readTransformPosition(current.transform).x, value),
              }), FIG_NODE_MUTATION_SOURCE.propertyPanel);
              return;
          }
        }}
      />
    </section>
  );
}
