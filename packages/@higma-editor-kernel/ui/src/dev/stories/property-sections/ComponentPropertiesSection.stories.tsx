/** @file ComponentPropertiesSectionView stories. */

import { useState } from "react";
import {
  ComponentPropertiesSectionView,
  type ResolvedComponentPropertyView,
} from "../../../property-sections";
import type { SelectOption } from "../../../types";
import type { ComponentEntry, Story } from "../../types";

const REFERENCE_OPTIONS: readonly SelectOption<string>[] = [
  { value: "", label: "None" },
  { value: "comp-a", label: "Button / Primary" },
  { value: "comp-b", label: "Button / Secondary" },
];

function Interactive() {
  const [properties, setProperties] = useState<readonly ResolvedComponentPropertyView[]>([
    {
      id: "p-1",
      name: "Show label",
      type: "BOOL",
      value: { kind: "bool", value: true },
      isOverridden: false,
    },
    {
      id: "p-2",
      name: "Label",
      type: "TEXT",
      value: { kind: "text", value: "Click me" },
      isOverridden: true,
    },
    {
      id: "p-3",
      name: "Size",
      type: "NUMBER",
      value: { kind: "number", value: 14 },
      isOverridden: false,
    },
    {
      id: "p-4",
      name: "Icon",
      type: "INSTANCE_SWAP",
      value: { kind: "reference", value: "comp-a" },
      isOverridden: false,
    },
  ]);

  return (
    <div style={{ width: 360 }}>
      <ComponentPropertiesSectionView
        componentName="Button"
        properties={properties}
        referenceOptions={REFERENCE_OPTIONS}
        instanceSwapOptions={REFERENCE_OPTIONS}
        onValueChange={(id, value) => {
          setProperties((current) => current.map((prop) => prop.id === id ? { ...prop, value, isOverridden: true } : prop));
        }}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const empty: Story = {
  name: "Empty",
  render: () => (
    <div style={{ width: 360 }}>
      <ComponentPropertiesSectionView
        componentName="EmptyComponent"
        properties={[]}
        referenceOptions={REFERENCE_OPTIONS}
        instanceSwapOptions={REFERENCE_OPTIONS}
        onValueChange={() => {}}
      />
    </div>
  ),
};

export const ComponentPropertiesSectionStories: ComponentEntry = {
  name: "ComponentPropertiesSection",
  description: "Resolved component properties with overrides.",
  stories: [interactive, empty],
};
