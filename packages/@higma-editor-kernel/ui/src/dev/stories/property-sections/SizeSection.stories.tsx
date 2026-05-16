/** @file SizeSectionView stories. */

import { useState } from "react";
import { SizeSectionView, type SizeSectionField } from "../../../property-sections";
import { SuffixSelect } from "../../../primitives";
import type { SelectOption } from "../../../types";
import type { ComponentEntry, Story } from "../../types";

type State = { width: number; height: number };
type SizingMode = "FIXED" | "HUG" | "FILL";

const SIZING_OPTIONS: readonly SelectOption<SizingMode>[] = [
  { value: "FIXED", label: "px" },
  { value: "HUG", label: "Hug" },
  { value: "FILL", label: "Fill" },
];

function Interactive() {
  const [state, setState] = useState<State>({ width: 200, height: 120 });
  return (
    <div style={{ width: 260 }}>
      <SizeSectionView
        width={state.width}
        height={state.height}
        onChange={(field: SizeSectionField, value: number) =>
          setState((current) => (field === "w" ? { ...current, width: value } : { ...current, height: value }))
        }
      />
    </div>
  );
}

const interactive: Story = {
  name: "Interactive",
  render: () => <Interactive />,
};

function WithSizingMode() {
  const [state, setState] = useState<State>({ width: 200, height: 120 });
  const [widthMode, setWidthMode] = useState<SizingMode>("FIXED");
  const [heightMode, setHeightMode] = useState<SizingMode>("HUG");
  return (
    <div style={{ width: 260, display: "flex", flexDirection: "column", gap: 8 }}>
      <SizeSectionView
        width={state.width}
        height={state.height}
        onChange={(field: SizeSectionField, value: number) =>
          setState((current) => (field === "w" ? { ...current, width: value } : { ...current, height: value }))
        }
        widthSuffix={
          <SuffixSelect
            value={widthMode}
            options={SIZING_OPTIONS}
            onChange={setWidthMode}
            ariaLabel="Width sizing mode"
          />
        }
        heightSuffix={
          <SuffixSelect
            value={heightMode}
            options={SIZING_OPTIONS}
            onChange={setHeightMode}
            ariaLabel="Height sizing mode"
          />
        }
      />
      <span style={{ fontSize: 11, color: "#999" }}>
        W mode: {widthMode} · H mode: {heightMode}
      </span>
    </div>
  );
}

const withSizingMode: Story = {
  name: "With Sizing Mode",
  render: () => <WithSizingMode />,
};

export const SizeSectionStories: ComponentEntry = {
  name: "SizeSection",
  description: "W/H size editor. Suffix is the unit (px) by default; consumers can swap it for a SuffixSelect (Fixed/Hug/Fill) when the parent is an AutoLayout container.",
  stories: [interactive, withSizingMode],
};
