/** @file Effects property section. */
import type { FigNode } from "@higma-document-models/fig/types";
import { EffectsSectionView, type EffectView } from "@higma-editor-kernel/ui/property-sections";
import { useFigEditor } from "../../../context/FigEditorContext";
import { sectionStyle, sectionTitleStyle } from "../../properties/PropertyPanel";
import { addEffect, effectSummary, effectToView, removeEffect, updateEffect } from "./effect-domain";

/** Render Kiwi effects as editable property controls. */
export function EffectsSection({ node }: { readonly node: FigNode }) {
  const { updateSelectedNodes } = useFigEditor();
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>Effects</div>
      <EffectsSectionView
        effects={(node.effects ?? []).map(effectToView)}
        onAdd={() => updateSelectedNodes((current) => ({ ...current, effects: addEffect(current.effects) }), "property-panel")}
        onRemove={(index) => updateSelectedNodes((current) => ({ ...current, effects: removeEffect(current.effects, index) }), "property-panel")}
        onChange={(index: number, effect: EffectView) => updateSelectedNodes(
          (current) => ({ ...current, effects: updateEffect(current.effects, index, effect) }),
          "property-panel",
        )}
      />
      <span hidden>{effectSummary(node.effects)} effect(s)</span>
    </section>
  );
}
