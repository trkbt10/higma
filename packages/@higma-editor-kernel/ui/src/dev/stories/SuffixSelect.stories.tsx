/** @file SuffixSelect stories. */

import { useState } from "react";
import { Input, SuffixSelect } from "../../primitives";
import type { SelectOption } from "../../types";
import type { ComponentEntry, Story } from "../types";

type RotationUnit = "deg" | "rad" | "turn";

const ROTATION_UNIT_OPTIONS: readonly SelectOption<RotationUnit>[] = [
  { value: "deg", label: "°" },
  { value: "rad", label: "rad" },
  { value: "turn", label: "turn" },
];

function InteractiveDemo() {
  const [unit, setUnit] = useState<RotationUnit>("deg");
  const [value, setValue] = useState(45);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 200 }}>
      <Input
        value={value}
        onChange={(v) => setValue(Number(v))}
        type="number"
        ariaLabel="Rotation"
        prefix="R"
        dragToChange
        suffix={
          <SuffixSelect
            value={unit}
            options={ROTATION_UNIT_OPTIONS}
            onChange={setUnit}
            ariaLabel="Rotation unit"
          />
        }
      />
      <span style={{ fontSize: 11, color: "#999" }}>
        {value} {unit}
      </span>
    </div>
  );
}

const interactive: Story = {
  name: "Interactive",
  render: () => <InteractiveDemo />,
};

const standalone: Story = {
  name: "Standalone",
  render: () => (
    <div style={{ fontSize: 12 }}>
      <SuffixSelect
        value="deg"
        options={ROTATION_UNIT_OPTIONS}
        onChange={() => {}}
        ariaLabel="Standalone suffix select"
      />
    </div>
  ),
};

export const SuffixSelectStories: ComponentEntry = {
  name: "SuffixSelect",
  description: "Suffix slot that visually matches a static suffix label but acts as a dropdown.",
  stories: [interactive, standalone],
};
