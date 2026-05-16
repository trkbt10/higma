/** @file TransformSectionView stories. */

import { useState } from "react";
import {
  TransformSectionView,
  type TransformSectionField,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

type TransformState = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  originX: number;
  originY: number;
};

function Interactive() {
  const [state, setState] = useState<TransformState>({
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    rotation: 0,
    originX: 100,
    originY: 60,
  });

  const handleChange = (field: TransformSectionField, value: number) => {
    setState((current) => {
      switch (field) {
        case "x":
          return { ...current, x: value };
        case "y":
          return { ...current, y: value };
        case "w":
          return { ...current, width: value };
        case "h":
          return { ...current, height: value };
        case "rotation":
          return { ...current, rotation: value };
        case "originX":
          return { ...current, originX: value };
        case "originY":
          return { ...current, originY: value };
      }
    });
  };

  return (
    <div style={{ width: 260 }}>
      <TransformSectionView {...state} onChange={handleChange} />
    </div>
  );
}

const interactive: Story = {
  name: "Interactive",
  render: () => <Interactive />,
};

export const TransformSectionStories: ComponentEntry = {
  name: "TransformSection",
  description: "Position, size, rotation and transform origin.",
  stories: [interactive],
};
