/** @file ComponentSetVariantsSectionView stories. */

import { useState } from "react";
import {
  ComponentSetVariantsSectionView,
  type VariantChildValueView,
  type VariantDefView,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [defs, setDefs] = useState<readonly VariantDefView[]>([
    { id: "d-1", name: "Style" },
    { id: "d-2", name: "Size" },
  ]);
  const [values, setValues] = useState<readonly VariantChildValueView[]>([
    { childId: "c-1", defId: "d-1", childName: "Button/Primary", defName: "Style", value: "Primary" },
    { childId: "c-1", defId: "d-2", childName: "Button/Primary", defName: "Size", value: "Large" },
    { childId: "c-2", defId: "d-1", childName: "Button/Secondary", defName: "Style", value: "Secondary" },
    { childId: "c-2", defId: "d-2", childName: "Button/Secondary", defName: "Size", value: "Large" },
  ]);

  return (
    <div style={{ width: 360 }}>
      <ComponentSetVariantsSectionView
        variantDefs={defs}
        childValues={values}
        onDefNameChange={(defId, name) => setDefs((current) => current.map((def) => def.id === defId ? { ...def, name } : def))}
        onChildValueChange={(childId, defId, value) => setValues((current) => current.map((entry) =>
          entry.childId === childId && entry.defId === defId ? { ...entry, value } : entry
        ))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const ComponentSetVariantsSectionStories: ComponentEntry = {
  name: "ComponentSetVariantsSection",
  description: "Variant definitions and child variant values.",
  stories: [interactive],
};
