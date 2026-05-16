/** @file RotationSectionView stories. */

import { useState } from "react";
import { RotationSectionView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [rotation, setRotation] = useState(0);
  const [log, setLog] = useState<readonly string[]>([]);
  return (
    <div style={{ width: 260, display: "flex", flexDirection: "column", gap: 8 }}>
      <RotationSectionView
        rotation={rotation}
        onRotationChange={setRotation}
        onRotateCW={() => {
          setRotation((current) => (current + 90) % 360);
          setLog((entries) => [...entries.slice(-3), "rotate +90°"]);
        }}
        onFlipHorizontal={() => setLog((entries) => [...entries.slice(-3), "flip H"])}
        onFlipVertical={() => setLog((entries) => [...entries.slice(-3), "flip V"])}
      />
      <span style={{ fontSize: 11, color: "#999" }}>
        {log.length === 0 ? "Drag the R prefix or click an action" : log.join(" · ")}
      </span>
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const angleOnly: Story = {
  name: "Angle Only",
  render: () => {
    const [rotation, setRotation] = useState(0);
    return (
      <div style={{ width: 260 }}>
        <RotationSectionView rotation={rotation} onRotationChange={setRotation} />
      </div>
    );
  },
};

export const RotationSectionStories: ComponentEntry = {
  name: "RotationSection",
  description: "Rotation angle input plus rotate/flip quick-action buttons. Quick-action handlers are optional.",
  stories: [interactive, angleOnly],
};
