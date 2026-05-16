/** @file PositionSectionView stories. */

import { useState } from "react";
import { PositionSectionView, type PositionSectionField } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

type State = { x: number; y: number };

function Interactive() {
  const [state, setState] = useState<State>({ x: 0, y: 0 });
  return (
    <div style={{ width: 260 }}>
      <PositionSectionView
        x={state.x}
        y={state.y}
        onChange={(field: PositionSectionField, value: number) =>
          setState((current) => ({ ...current, [field]: value }))
        }
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const PositionSectionStories: ComponentEntry = {
  name: "PositionSection",
  description: "X/Y position editor. Pre-rotation top-left coordinates. Suffix is always the unit (px); prefix labels (X/Y) are also Figma-style drag scrubbers.",
  stories: [interactive],
};
