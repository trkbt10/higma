/** @file VariantPropertiesSectionView stories. */

import { useState } from "react";
import { VariantPropertiesSectionView, type VariantPropertyView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [specs, setSpecs] = useState<readonly VariantPropertyView[]>([
    { id: "v-1", value: "Primary" },
    { id: "v-2", value: "Large" },
  ]);
  return (
    <div style={{ width: 280 }}>
      <VariantPropertiesSectionView
        specs={specs}
        onChange={(id, value) => setSpecs((current) => current.map((spec) => spec.id === id ? { ...spec, value } : spec))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const VariantPropertiesSectionStories: ComponentEntry = {
  name: "VariantPropertiesSection",
  description: "Variant property values for SYMBOL nodes.",
  stories: [interactive],
};
