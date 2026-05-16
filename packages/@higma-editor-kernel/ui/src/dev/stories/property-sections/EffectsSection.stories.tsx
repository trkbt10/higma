/** @file EffectsSectionView stories. */

import { useState } from "react";
import { EffectsSectionView, type EffectView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function defaultDropShadow(): EffectView {
  return {
    type: "DROP_SHADOW",
    visible: true,
    radius: 8,
    offsetX: 0,
    offsetY: 4,
    spread: 0,
    blendMode: "NORMAL",
    hex: "#000000",
    opacity: 0.25,
    showShadowBehindNode: true,
  };
}

function Interactive() {
  const [effects, setEffects] = useState<readonly EffectView[]>([defaultDropShadow()]);
  return (
    <div style={{ width: 360 }}>
      <EffectsSectionView
        effects={effects}
        onAdd={() => setEffects((current) => [...current, defaultDropShadow()])}
        onRemove={(index) => setEffects((current) => current.filter((_, i) => i !== index))}
        onChange={(index, effect) => setEffects((current) => current.map((existing, i) => i === index ? effect : existing))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const empty: Story = {
  name: "Empty",
  render: () => (
    <div style={{ width: 360 }}>
      <EffectsSectionView effects={[]} onAdd={() => {}} onRemove={() => {}} onChange={() => {}} />
    </div>
  ),
};

export const EffectsSectionStories: ComponentEntry = {
  name: "EffectsSection",
  description: "Drop/inner shadow and blur list editor.",
  stories: [interactive, empty],
};
