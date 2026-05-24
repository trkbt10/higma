/** @file Outline operation section. */
import { OutlineSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { canOutlineKiwiNode, outlineKiwiNode } from "./outline-node";

/** Render outline operations when they are exposed for a vector-like node. */
export function OutlineSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (!canOutlineKiwiNode(node)) {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("OutlineSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Outline</div>
      <OutlineSectionView
        enabled
        onOutline={() => updateNode(guid, outlineKiwiNode, FIG_NODE_MUTATION_SOURCE.propertyPanel)}
      />
    </section>
  );
}
