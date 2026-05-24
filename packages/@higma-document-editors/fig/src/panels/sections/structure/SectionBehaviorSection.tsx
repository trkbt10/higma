/** @file SECTION behavior section. */
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { SectionBehaviorSectionView } from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";

/** Render SECTION-specific visibility behavior controls. */
export function SectionBehaviorSection({ node }: { readonly node: FigNode }) {
  const { updateNode } = useFigEditor();
  if (getNodeType(node) !== "SECTION") {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("SectionBehaviorSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Section</div>
      <SectionBehaviorSectionView
        contentsHidden={node.sectionContentsHidden === true}
        onContentsHiddenChange={(hidden) => updateNode(guid, (current) => ({
          ...current,
          sectionContentsHidden: hidden,
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
      />
    </section>
  );
}
