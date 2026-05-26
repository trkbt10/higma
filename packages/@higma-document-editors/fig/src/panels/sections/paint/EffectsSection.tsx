/** @file Effects property section. */
import { memo } from "react";
import { sameKiwiNodeExceptTransform } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { EffectsSectionView, type EffectView } from "@higma-editor-kernel/ui/property-sections";
import { FIG_NODE_MUTATION_SOURCE, useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { addEffect, effectSummary, effectToView, removeEffect, updateEffect } from "./effect-domain";

type EffectsSectionProps = {
  readonly node: FigNode;
};

/** Render Kiwi effects as editable property controls. */
function EffectsSectionContent({ node }: EffectsSectionProps) {
  const { updateSelectedNodes } = useFigEditor();
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Effects</div>
      <EffectsSectionView
        effects={(node.effects ?? []).map(effectToView)}
        onAdd={() => updateSelectedNodes((current) => ({ ...current, effects: addEffect(current.effects) }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onRemove={(index) => updateSelectedNodes((current) => ({ ...current, effects: removeEffect(current.effects, index) }), FIG_NODE_MUTATION_SOURCE.propertyPanel)}
        onChange={(index: number, effect: EffectView) => updateSelectedNodes(
          (current) => ({ ...current, effects: updateEffect(current.effects, index, effect) }),
          FIG_NODE_MUTATION_SOURCE.propertyPanel,
        )}
      />
      <span hidden>{effectSummary(node.effects)} effect(s)</span>
    </section>
  );
}

function sameEffectsSectionProps(left: EffectsSectionProps, right: EffectsSectionProps): boolean {
  return sameKiwiNodeExceptTransform(left.node, right.node);
}

export const EffectsSection = memo(EffectsSectionContent, sameEffectsSectionProps);
