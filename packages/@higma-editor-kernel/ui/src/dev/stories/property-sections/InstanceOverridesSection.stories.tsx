/** @file InstanceOverridesSectionView stories. */

import { useState } from "react";
import {
  InstanceOverridesSectionView,
  type InstanceOverrideRowView,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [selfRow, setSelfRow] = useState<InstanceOverrideRowView>({
    key: "self",
    label: "Opacity override",
    opacityPercent: 80,
  });
  const [childRows, setChildRows] = useState<readonly InstanceOverrideRowView[]>([
    { key: "child-1", label: "Card / Title", opacityPercent: 100 },
    { key: "child-2", label: "Card / Subtitle", opacityPercent: 70 },
  ]);

  return (
    <div style={{ width: 360 }}>
      <InstanceOverridesSectionView
        selfRow={selfRow}
        childRows={childRows}
        onOpacityChange={(key, percent) => {
          if (key === selfRow.key) {
            setSelfRow((current) => ({ ...current, opacityPercent: percent }));
            return;
          }
          setChildRows((current) => current.map((row) => row.key === key ? { ...row, opacityPercent: percent } : row));
        }}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const InstanceOverridesSectionStories: ComponentEntry = {
  name: "InstanceOverridesSection",
  description: "INSTANCE self and nested overrides — opacity only.",
  stories: [interactive],
};
