/** @file AlignmentControls stories. */

import { useState } from "react";
import { AlignmentControls, type AlignmentAxis, type AlignmentPosition } from "../../../operations";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [log, setLog] = useState<readonly string[]>([]);
  return (
    <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 8 }}>
      <AlignmentControls
        onAlign={(axis: AlignmentAxis, position: AlignmentPosition) => {
          setLog((entries) => [...entries.slice(-4), `align ${axis}/${position}`]);
        }}
      />
      <span style={{ fontSize: 11, color: "#999" }}>
        {log.length === 0 ? "Click any alignment button" : log.join(" · ")}
      </span>
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const disabled: Story = {
  name: "Disabled (no parent)",
  render: () => (
    <div style={{ width: 240 }}>
      <AlignmentControls onAlign={() => {}} disabled />
    </div>
  ),
};

export const AlignmentControlsStories: ComponentEntry = {
  name: "AlignmentControls",
  description: "H+V alignment-within-parent button row from Figma's Position panel.",
  stories: [interactive, disabled],
};
