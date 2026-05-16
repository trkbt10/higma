/** @file StrokeSectionView stories. */

import { useState } from "react";
import {
  StrokeSectionView,
  type StrokeAlignId,
  type StrokeCapId,
  type StrokeJoinId,
} from "../../../property-sections";
import { usePaintEditorState } from "./paint-state";
import type { ComponentEntry, Story } from "../../types";

function Interactive() {
  const state = usePaintEditorState([
    { type: "SOLID", hex: "#1f2937", opacity: 1 },
  ]);
  const [strokeWeight, setStrokeWeight] = useState(2);
  const [align, setAlign] = useState<StrokeAlignId>("CENTER");
  const [cap, setCap] = useState<StrokeCapId>("NONE");
  const [join, setJoin] = useState<StrokeJoinId>("MITER");
  const [dashes, setDashes] = useState<readonly number[]>([]);

  return (
    <div style={{ width: 320 }}>
      <StrokeSectionView
        strokes={state.paints}
        strokeWeight={strokeWeight}
        align={align}
        cap={cap}
        join={join}
        dashes={dashes}
        imageOptions={state.imageOptions}
        fileInputRef={state.fileInputRef}
        onImageFileChange={state.onImageFileChange}
        onStrokeWeightChange={setStrokeWeight}
        onAlignChange={setAlign}
        onCapChange={setCap}
        onJoinChange={setJoin}
        onDashesChange={setDashes}
        onAddPaint={state.addPaint}
        handlers={state.handlers}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const StrokeSectionStories: ComponentEntry = {
  name: "StrokeSection",
  description: "Stroke paints plus weight/align/cap/join/dash.",
  stories: [interactive],
};
