/** @file Size property section. */
import { SizeSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

function requireCurrentSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error("SizeSection update requires Kiwi node size");
  }
  return node.size;
}

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
      <SizeSectionView
        width={size.x}
        height={size.y}
        onChange={(field, value) => {
          switch (field) {
            case "w":
              updateNode(guid, (current) => {
                const currentSize = requireCurrentSize(current);
                return { ...current, size: { x: value, y: currentSize.y } };
              }, FIG_NODE_MUTATION_SOURCE.propertyPanel);
              return;
            case "h":
              updateNode(guid, (current) => {
                const currentSize = requireCurrentSize(current);
                return { ...current, size: { x: currentSize.x, y: value } };
              }, FIG_NODE_MUTATION_SOURCE.propertyPanel);
              return;
          }
        }}
      />
    </section>
  );
}
