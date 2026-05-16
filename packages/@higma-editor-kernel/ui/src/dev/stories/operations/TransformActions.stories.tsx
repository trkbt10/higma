/** @file TransformActions stories. */

import { useState } from "react";
import { TransformActions } from "../../../operations";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [log, setLog] = useState<readonly string[]>([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <TransformActions
        onRotateCW={() => setLog((entries) => [...entries.slice(-4), "rotate 90° CW"])}
        onFlipHorizontal={() => setLog((entries) => [...entries.slice(-4), "flip H"])}
        onFlipVertical={() => setLog((entries) => [...entries.slice(-4), "flip V"])}
      />
      <span style={{ fontSize: 11, color: "#999" }}>
        {log.length === 0 ? "Click any transform action" : log.join(" · ")}
      </span>
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const flipOnly: Story = {
  name: "Flip Only (no rotate)",
  render: () => (
    <TransformActions onFlipHorizontal={() => {}} onFlipVertical={() => {}} />
  ),
};

export const TransformActionsStories: ComponentEntry = {
  name: "TransformActions",
  description: "Rotate/flip quick-action buttons. Each handler is optional; buttons render only when provided.",
  stories: [interactive, flipOnly],
};
