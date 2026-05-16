/** @file FillSectionView stories. */

import { FillSectionView } from "../../../property-sections";
import { usePaintEditorState } from "./paint-state";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const state = usePaintEditorState([
    { type: "SOLID", hex: "#3b82f6", opacity: 1 },
    {
      type: "GRADIENT_LINEAR",
      hex: "#3b82f6",
      opacity: 0.8,
      gradient: {
        stops: [
          { position: 0, hex: "#3b82f6", alpha: 1 },
          { position: 1, hex: "#ec4899", alpha: 1 },
        ],
        handles: [
          { x: 0, y: 0.5 },
          { x: 1, y: 0.5 },
          { x: 0, y: 1 },
        ],
      },
    },
  ]);
  return (
    <div style={{ width: 320 }}>
      <FillSectionView
        fills={state.paints}
        imageOptions={state.imageOptions}
        fileInputRef={state.fileInputRef}
        onImageFileChange={state.onImageFileChange}
        onAddPaint={state.addPaint}
        handlers={state.handlers}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

function EmptyExample() {
  const state = usePaintEditorState([]);
  return (
    <div style={{ width: 320 }}>
      <FillSectionView
        fills={state.paints}
        imageOptions={state.imageOptions}
        fileInputRef={state.fileInputRef}
        onImageFileChange={state.onImageFileChange}
        onAddPaint={state.addPaint}
        handlers={state.handlers}
      />
    </div>
  );
}

const empty: Story = { name: "Empty", render: () => <EmptyExample /> };

export const FillSectionStories: ComponentEntry = {
  name: "FillSection",
  description: "Fill paint list with per-item type/color/opacity controls.",
  stories: [interactive, empty],
};
