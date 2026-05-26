/** @file Child layout constraints section over Kiwi node fields. */

import { memo } from "react";
import { LayoutConstraintsSectionView } from "@higma-editor-kernel/ui/property-sections";
import { getNodeType, sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import {
  readKiwiConstraintType,
  readKiwiStackChildAlignSelf,
  readKiwiStackPositioning,
  readKiwiStackSizing,
  writeKiwiConstraintType,
  writeKiwiStackChildAlignSelf,
  writeKiwiStackPositioning,
  writeKiwiStackSizing,
} from "./kiwi-layout-section-fields";

type LayoutConstraintsSectionProps = {
  readonly node: FigNode;
};

function supportsChildLayoutFields(node: FigNode): boolean {
  if (node.parentIndex?.guid === undefined) {
    return false;
  }
  switch (getNodeType(node)) {
    case "DOCUMENT":
    case "CANVAS":
      return false;
    default:
      return true;
  }
}

/** Render editable child layout constraints through kernel UI views. */
function LayoutConstraintsSectionContent({ node }: LayoutConstraintsSectionProps) {
  const { updateNode } = useFigEditor();
  if (!supportsChildLayoutFields(node)) {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("LayoutConstraintsSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Constraints</div>
      <LayoutConstraintsSectionView
        positioning={readKiwiStackPositioning(node.stackPositioning)}
        primarySizing={readKiwiStackSizing(node.stackPrimarySizing, "LayoutConstraintsSection.stackPrimarySizing")}
        counterSizing={readKiwiStackSizing(node.stackCounterSizing, "LayoutConstraintsSection.stackCounterSizing")}
        horizontalConstraint={readKiwiConstraintType(node.horizontalConstraint, "LayoutConstraintsSection.horizontalConstraint")}
        verticalConstraint={readKiwiConstraintType(node.verticalConstraint, "LayoutConstraintsSection.verticalConstraint")}
        alignSelf={readKiwiStackChildAlignSelf(node.stackChildAlignSelf)}
        grow={node.stackChildPrimaryGrow ?? 0}
        onPositioningChange={(stackPositioning) => updateNode(guid, (current) => ({
          ...current,
          stackPositioning: writeKiwiStackPositioning(stackPositioning),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onPrimarySizingChange={(stackPrimarySizing) => updateNode(guid, (current) => ({
          ...current,
          stackPrimarySizing: writeKiwiStackSizing(stackPrimarySizing),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onCounterSizingChange={(stackCounterSizing) => updateNode(guid, (current) => ({
          ...current,
          stackCounterSizing: writeKiwiStackSizing(stackCounterSizing),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onHorizontalConstraintChange={(horizontalConstraint) => updateNode(guid, (current) => ({
          ...current,
          horizontalConstraint: writeKiwiConstraintType(horizontalConstraint),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onVerticalConstraintChange={(verticalConstraint) => updateNode(guid, (current) => ({
          ...current,
          verticalConstraint: writeKiwiConstraintType(verticalConstraint),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onAlignSelfChange={(stackChildAlignSelf) => updateNode(guid, (current) => ({
          ...current,
          stackChildAlignSelf: writeKiwiStackChildAlignSelf(stackChildAlignSelf),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onGrowChange={(stackChildPrimaryGrow) => updateNode(guid, (current) => ({
          ...current,
          stackChildPrimaryGrow,
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
      />
    </section>
  );
}

function sameLayoutConstraintsSectionProps(
  left: LayoutConstraintsSectionProps,
  right: LayoutConstraintsSectionProps,
): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const LayoutConstraintsSection = memo(
  LayoutConstraintsSectionContent,
  sameLayoutConstraintsSectionProps,
);
