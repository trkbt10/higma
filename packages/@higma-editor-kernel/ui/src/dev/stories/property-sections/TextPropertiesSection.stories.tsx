/** @file TextPropertiesSectionView stories. */

import { useState } from "react";
import {
  TextPropertiesSectionView,
  type AutoResizeId,
  type VerticalAlignId,
} from "../../../property-sections";
import type { ComponentEntry, Story } from "../../types";

type State = {
  characters: string;
  lineHeightMultiplier: number | undefined;
  verticalAlign: VerticalAlignId;
  autoResize: AutoResizeId;
};

function FormattingPlaceholder() {
  return (
    <div style={{
      padding: 8,
      background: "var(--bg-tertiary, #f0f1f3)",
      borderRadius: 4,
      fontSize: 11,
      color: "var(--text-tertiary, #737373)",
    }}>
      Formatting editor slot (provided by document editor)
    </div>
  );
}

function JustifyPlaceholder() {
  return (
    <div style={{
      padding: 8,
      background: "var(--bg-tertiary, #f0f1f3)",
      borderRadius: 4,
      fontSize: 11,
      color: "var(--text-tertiary, #737373)",
    }}>
      Horizontal-alignment slot (provided by document editor)
    </div>
  );
}

function Interactive() {
  const [state, setState] = useState<State>({
    characters: "Hello world",
    lineHeightMultiplier: 1.4,
    verticalAlign: "TOP",
    autoResize: "WIDTH_AND_HEIGHT",
  });

  return (
    <div style={{ width: 320 }}>
      <TextPropertiesSectionView
        characters={state.characters}
        onCharactersChange={(characters) => setState((s) => ({ ...s, characters }))}
        formattingSlot={<FormattingPlaceholder />}
        justifySlot={<JustifyPlaceholder />}
        lineHeightMultiplier={state.lineHeightMultiplier}
        onLineHeightMultiplierChange={(value) => setState((s) => ({ ...s, lineHeightMultiplier: value }))}
        verticalAlign={state.verticalAlign}
        onVerticalAlignChange={(verticalAlign) => setState((s) => ({ ...s, verticalAlign }))}
        autoResize={state.autoResize}
        onAutoResizeChange={(autoResize) => setState((s) => ({ ...s, autoResize }))}
      />
    </div>
  );
}

const interactive: Story = { name: "Interactive", render: () => <Interactive /> };

export const TextPropertiesSectionStories: ComponentEntry = {
  name: "TextPropertiesSection",
  description: "Text content + vertical-align + auto-resize. Formatting and justify blocks are slot props.",
  stories: [interactive],
};
