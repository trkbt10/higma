/** @file OutlineSectionView stories. */

import { useState } from "react";
import { OutlineSectionView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive({ enabled, withNote }: { enabled: boolean; withNote: boolean }) {
  const [calls, setCalls] = useState(0);
  return (
    <div style={{ width: 260, display: "flex", flexDirection: "column", gap: 8 }}>
      <OutlineSectionView
        enabled={enabled}
        onOutline={() => setCalls((c) => c + 1)}
        note={withNote ? "Text outlines require glyph path data in the fig document." : undefined}
      />
      <span style={{ fontSize: 11, color: "#999" }}>Triggered {calls} time(s)</span>
    </div>
  );
}

const interactive: Story<{ enabled: boolean; withNote: boolean }> = {
  name: "Interactive",
  render: (props) => <Interactive {...props} />,
  controls: {
    enabled: { label: "Enabled", control: { type: "boolean" }, defaultValue: true },
    withNote: { label: "Show note", control: { type: "boolean" }, defaultValue: false },
  },
  defaultProps: { enabled: true, withNote: false },
};

export const OutlineSectionStories: ComponentEntry = {
  name: "OutlineSection",
  description: "Outline-selection button with optional note.",
  stories: [interactive],
};
