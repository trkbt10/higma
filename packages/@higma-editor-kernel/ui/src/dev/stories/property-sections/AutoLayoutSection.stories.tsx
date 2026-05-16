/** @file AutoLayoutSectionView stories. */

import { useState } from "react";
import {
  AutoLayoutSectionView,
  type AutoLayoutPadding,
  type AutoLayoutPaddingSide,
  type StackAlignId,
  type StackModeId,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

type State = {
  mode: StackModeId;
  gap: number;
  padding: AutoLayoutPadding;
  primaryAlign: StackAlignId;
  counterAlign: StackAlignId;
  alignContent: StackAlignId;
  counterGap: number;
  wrap: boolean;
  reverseZ: boolean;
};

function Interactive() {
  const [state, setState] = useState<State>({
    mode: "HORIZONTAL",
    gap: 8,
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    primaryAlign: "MIN",
    counterAlign: "CENTER",
    alignContent: "MIN",
    counterGap: 0,
    wrap: false,
    reverseZ: false,
  });

  return (
    <div style={{ width: 280 }}>
      <AutoLayoutSectionView
        {...state}
        onModeChange={(mode) => setState((s) => ({ ...s, mode }))}
        onGapChange={(gap) => setState((s) => ({ ...s, gap }))}
        onPaddingChange={(side: AutoLayoutPaddingSide, value: number) => setState((s) => ({ ...s, padding: { ...s.padding, [side]: value } }))}
        onPrimaryAlignChange={(primaryAlign) => setState((s) => ({ ...s, primaryAlign }))}
        onCounterAlignChange={(counterAlign) => setState((s) => ({ ...s, counterAlign }))}
        onAlignContentChange={(alignContent) => setState((s) => ({ ...s, alignContent }))}
        onCounterGapChange={(counterGap) => setState((s) => ({ ...s, counterGap }))}
        onWrapChange={(wrap) => setState((s) => ({ ...s, wrap }))}
        onReverseZChange={(reverseZ) => setState((s) => ({ ...s, reverseZ }))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const AutoLayoutSectionStories: ComponentEntry = {
  name: "AutoLayoutSection",
  description: "Auto layout mode, gap, padding, alignment and wrap.",
  stories: [interactive],
};
