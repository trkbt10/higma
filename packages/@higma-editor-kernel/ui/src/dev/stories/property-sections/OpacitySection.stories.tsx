/** @file OpacitySectionView stories. */

import { useState } from "react";
import { OpacitySectionView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive({ disabled }: { disabled: boolean }) {
  const [percent, setPercent] = useState(75);
  return (
    <div style={{ width: 240 }}>
      <OpacitySectionView percent={percent} onPercentChange={setPercent} disabled={disabled} />
    </div>
  );
}

const interactive: Story<{ disabled: boolean }> = {
  name: "Interactive",
  render: ({ disabled }) => <Interactive disabled={disabled} />,
  controls: {
    disabled: { label: "Disabled", control: { type: "boolean" }, defaultValue: false },
  },
  defaultProps: { disabled: false },
};

export const OpacitySectionStories: ComponentEntry = {
  name: "OpacitySection",
  description: "Single 0-100% opacity input.",
  stories: [interactive],
};
