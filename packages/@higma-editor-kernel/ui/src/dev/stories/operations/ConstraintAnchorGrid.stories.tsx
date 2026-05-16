/** @file ConstraintAnchorGrid stories. */

import { useState } from "react";
import {
  ConstraintAnchorGrid,
  type ConstraintAxisAnchor,
} from "../../../operations";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const [horizontal, setHorizontal] = useState<ConstraintAxisAnchor>("MIN");
  const [vertical, setVertical] = useState<ConstraintAxisAnchor>("MIN");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <ConstraintAnchorGrid
        horizontal={horizontal}
        vertical={vertical}
        onChange={({ horizontal: h, vertical: v }) => {
          setHorizontal(h);
          setVertical(v);
        }}
      />
      <div style={{ fontSize: 11, color: "#999" }}>
        H: {horizontal} · V: {vertical}
      </div>
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

const stretched: Story = {
  name: "Stretch on Both Axes",
  render: () => {
    const [horizontal, setHorizontal] = useState<ConstraintAxisAnchor>("STRETCH");
    const [vertical, setVertical] = useState<ConstraintAxisAnchor>("STRETCH");
    return (
      <ConstraintAnchorGrid
        horizontal={horizontal}
        vertical={vertical}
        onChange={({ horizontal: h, vertical: v }) => {
          setHorizontal(h);
          setVertical(v);
        }}
      />
    );
  },
};

export const ConstraintAnchorGridStories: ComponentEntry = {
  name: "ConstraintAnchorGrid",
  description: "3x3 constraint anchor selector. Click cells to set MIN/CENTER/MAX on both axes; click the edge handles to toggle STRETCH on the matching axis.",
  stories: [interactive, stretched],
};
