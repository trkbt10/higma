/** @file LayoutConstraintsSectionView stories. */

import { useState } from "react";
import {
  LayoutConstraintsSectionView,
  type ConstraintTypeId,
  type StackCounterAlignId,
  type StackPositioningId,
  type StackSizingId,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

type State = {
  positioning: StackPositioningId;
  primarySizing: StackSizingId;
  counterSizing: StackSizingId;
  horizontalConstraint: ConstraintTypeId;
  verticalConstraint: ConstraintTypeId;
  alignSelf: StackCounterAlignId;
  grow: number;
};

function Interactive() {
  const [state, setState] = useState<State>({
    positioning: "AUTO",
    primarySizing: "FIXED",
    counterSizing: "FIXED",
    horizontalConstraint: "MIN",
    verticalConstraint: "MIN",
    alignSelf: "MIN",
    grow: 0,
  });

  return (
    <div style={{ width: 320 }}>
      <LayoutConstraintsSectionView
        {...state}
        onPositioningChange={(positioning) => setState((s) => ({ ...s, positioning }))}
        onPrimarySizingChange={(primarySizing) => setState((s) => ({ ...s, primarySizing }))}
        onCounterSizingChange={(counterSizing) => setState((s) => ({ ...s, counterSizing }))}
        onHorizontalConstraintChange={(horizontalConstraint) => setState((s) => ({ ...s, horizontalConstraint }))}
        onVerticalConstraintChange={(verticalConstraint) => setState((s) => ({ ...s, verticalConstraint }))}
        onAlignSelfChange={(alignSelf) => setState((s) => ({ ...s, alignSelf }))}
        onGrowChange={(grow) => setState((s) => ({ ...s, grow }))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const LayoutConstraintsSectionStories: ComponentEntry = {
  name: "LayoutConstraintsSection",
  description: "Stack positioning, sizing, alignment and grow controls.",
  stories: [interactive],
};
