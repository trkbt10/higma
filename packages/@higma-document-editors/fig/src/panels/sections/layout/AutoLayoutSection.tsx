/** @file Auto layout section over Kiwi FRAME/SYMBOL layout fields. */

import { memo } from "react";
import { AutoLayoutSectionView, type AutoLayoutPaddingSide } from "@higma-editor-kernel/ui/property-sections";
import { getNodeType, sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import {
  readKiwiAutoLayoutPadding,
  readKiwiStackAlign,
  readKiwiStackMode,
  readKiwiStackPrimaryAlignItems,
  readKiwiStackWrap,
  writeKiwiStackAlign,
  writeKiwiStackMode,
  writeKiwiStackPrimaryAlignItems,
  writeKiwiStackWrap,
} from "./kiwi-layout-section-fields";

type AutoLayoutSectionProps = {
  readonly node: FigNode;
};

function supportsAutoLayoutContainer(node: FigNode): boolean {
  switch (getNodeType(node)) {
    case "FRAME":
    case "SECTION":
    case "SLIDE":
    case "SYMBOL":
      return true;
    default:
      return false;
  }
}

function updateKiwiAutoLayoutPadding(
  node: FigNode,
  side: AutoLayoutPaddingSide,
  value: number,
): FigNode {
  switch (side) {
    case "top":
      return { ...node, stackVerticalPadding: value };
    case "left":
      return { ...node, stackHorizontalPadding: value };
    case "right":
      return { ...node, stackPaddingRight: value };
    case "bottom":
      return { ...node, stackPaddingBottom: value };
  }
}

/** Render editable auto-layout controls through kernel UI views. */
function AutoLayoutSectionContent({ node }: AutoLayoutSectionProps) {
  const { updateNode } = useFigEditor();
  if (!supportsAutoLayoutContainer(node) && node.stackMode === undefined) {
    return null;
  }
  if (node.guid === undefined) {
    throw new Error("AutoLayoutSection requires a Kiwi node guid");
  }
  const guid = node.guid;
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Auto layout</div>
      <AutoLayoutSectionView
        mode={readKiwiStackMode(node.stackMode)}
        gap={node.stackSpacing ?? 0}
        padding={readKiwiAutoLayoutPadding(node)}
        primaryAlign={readKiwiStackPrimaryAlignItems(node.stackPrimaryAlignItems)}
        counterAlign={readKiwiStackAlign(node.stackCounterAlignItems, "AutoLayoutSection.stackCounterAlignItems")}
        alignContent={readKiwiStackPrimaryAlignItems(node.stackPrimaryAlignContent)}
        counterGap={node.stackCounterSpacing ?? 0}
        wrap={readKiwiStackWrap(node.stackWrap)}
        reverseZ={node.stackReverseZIndex === true}
        onModeChange={(mode) => updateNode(guid, (current) => ({
          ...current,
          stackMode: writeKiwiStackMode(mode),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onGapChange={(stackSpacing) => updateNode(guid, (current) => ({
          ...current,
          stackSpacing,
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onPaddingChange={(side, value) => updateNode(guid, (current) => (
          updateKiwiAutoLayoutPadding(current, side, value)
        ), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onPrimaryAlignChange={(align) => updateNode(guid, (current) => ({
          ...current,
          stackPrimaryAlignItems: writeKiwiStackPrimaryAlignItems(align),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onCounterAlignChange={(align) => updateNode(guid, (current) => ({
          ...current,
          stackCounterAlignItems: writeKiwiStackAlign(align),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onAlignContentChange={(align) => updateNode(guid, (current) => ({
          ...current,
          stackPrimaryAlignContent: writeKiwiStackPrimaryAlignItems(align),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onCounterGapChange={(stackCounterSpacing) => updateNode(guid, (current) => ({
          ...current,
          stackCounterSpacing,
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onWrapChange={(wrap) => updateNode(guid, (current) => ({
          ...current,
          stackWrap: writeKiwiStackWrap(wrap),
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onReverseZChange={(stackReverseZIndex) => updateNode(guid, (current) => ({
          ...current,
          stackReverseZIndex,
        }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
      />
    </section>
  );
}

function sameAutoLayoutSectionProps(left: AutoLayoutSectionProps, right: AutoLayoutSectionProps): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const AutoLayoutSection = memo(AutoLayoutSectionContent, sameAutoLayoutSectionProps);
