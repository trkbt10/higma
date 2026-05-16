/** @file ExportSettingsSectionView stories. */

import { useState } from "react";
import {
  ExportSettingsSectionView,
  type ExportFormatId,
  type ExportPresetView,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [presets, setPresets] = useState<readonly ExportPresetView[]>([
    { format: "PNG", suffix: "", scale: 1 },
    { format: "PNG", suffix: "@2x", scale: 2 },
  ]);

  const update = (index: number, patch: Partial<ExportPresetView>) => {
    setPresets((current) => current.map((preset, i) => i === index ? { ...preset, ...patch } : preset));
  };

  return (
    <div style={{ width: 360 }}>
      <ExportSettingsSectionView
        presets={presets}
        onFormatChange={(index, format) => update(index, { format })}
        onSuffixChange={(index, suffix) => update(index, { suffix })}
        onScaleChange={(index, scale) => update(index, { scale })}
        onAddPreset={() => setPresets((current) => [...current, { format: "PNG" as ExportFormatId, suffix: "", scale: 1 }])}
        onRemovePreset={(index) => setPresets((current) => current.filter((_, i) => i !== index))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const empty: Story = {
  name: "Empty",
  render: () => (
    <div style={{ width: 360 }}>
      <ExportSettingsSectionView
        presets={[]}
        onFormatChange={() => {}}
        onSuffixChange={() => {}}
        onScaleChange={() => {}}
        onAddPreset={() => {}}
        onRemovePreset={() => {}}
      />
    </div>
  ),
};

export const ExportSettingsSectionStories: ComponentEntry = {
  name: "ExportSettings",
  description: "Export preset list (format + suffix + scale).",
  stories: [interactive, empty],
};
