/** @file CornerRadiusSectionView stories. */

import { useState } from "react";
import {
  CornerRadiusSectionView,
  type CornerRadiusIndex,
  type CornerRadiusTuple,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [mode, setMode] = useState<"uniform" | "individual">("uniform");
  const [uniform, setUniform] = useState(12);
  const [individual, setIndividual] = useState<CornerRadiusTuple>([12, 12, 12, 12]);

  return (
    <div style={{ width: 260 }}>
      <CornerRadiusSectionView
        mode={mode}
        uniformRadius={uniform}
        individualRadii={individual}
        onUniformChange={setUniform}
        onIndividualChange={(index: CornerRadiusIndex, value: number) => {
          setIndividual((current) => {
            const next: [number, number, number, number] = [...current] as [number, number, number, number];
            next[index] = value;
            return next;
          });
        }}
        onSwitchToIndividual={() => {
          setIndividual([uniform, uniform, uniform, uniform]);
          setMode("individual");
        }}
        onSwitchToUniform={() => {
          setUniform(individual[0]);
          setMode("uniform");
        }}
      />
    </div>
  );
}

const interactive: Story = {
  name: "Interactive",
  render: () => <Interactive />,
};

export const CornerRadiusSectionStories: ComponentEntry = {
  name: "CornerRadiusSection",
  description: "Uniform / per-corner radius editor.",
  stories: [interactive],
};
