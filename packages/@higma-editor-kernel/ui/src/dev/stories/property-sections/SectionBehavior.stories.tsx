/** @file SectionBehaviorSectionView stories. */

import { useState } from "react";
import { SectionBehaviorSectionView } from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [hidden, setHidden] = useState(false);
  return (
    <div style={{ width: 260 }}>
      <SectionBehaviorSectionView contentsHidden={hidden} onContentsHiddenChange={setHidden} />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const SectionBehaviorSectionStories: ComponentEntry = {
  name: "SectionBehavior",
  description: "Section-node 'hide contents' toggle.",
  stories: [interactive],
};
