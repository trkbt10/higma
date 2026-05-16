/** @file Effects section view (presentational only). */

import { type CSSProperties } from "react";
import { Input, Select, Toggle } from "../../primitives";
import type { SelectOption } from "../../types";
import { colorTokens, fontTokens } from "../../design-tokens";
import { AddIcon, CloseIcon } from "../../icons";
import { addButtonStyle, removeButtonStyle } from "./paint-section-styles";

export type EffectTypeId = "DROP_SHADOW" | "INNER_SHADOW" | "FOREGROUND_BLUR" | "BACKGROUND_BLUR";

export type BlendModeId =
  | "NORMAL"
  | "MULTIPLY"
  | "SCREEN"
  | "OVERLAY"
  | "DARKEN"
  | "LIGHTEN"
  | "COLOR_DODGE"
  | "COLOR_BURN"
  | "HARD_LIGHT"
  | "SOFT_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

export type EffectView = {
  readonly type: EffectTypeId;
  readonly visible: boolean;
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly spread: number;
  readonly blendMode: BlendModeId;
  readonly hex: string;
  /** 0..1 alpha. */
  readonly opacity: number;
  readonly showShadowBehindNode: boolean;
};

export type EffectsSectionViewProps = {
  readonly effects: readonly EffectView[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onChange: (index: number, effect: EffectView) => void;
};

export const EFFECT_TYPE_OPTIONS: readonly SelectOption<EffectTypeId>[] = [
  { value: "DROP_SHADOW", label: "Drop shadow" },
  { value: "INNER_SHADOW", label: "Inner shadow" },
  { value: "FOREGROUND_BLUR", label: "Layer blur" },
  { value: "BACKGROUND_BLUR", label: "Background blur" },
];

export const BLEND_MODE_OPTIONS: readonly SelectOption<BlendModeId>[] = [
  { value: "NORMAL", label: "Normal" },
  { value: "MULTIPLY", label: "Multiply" },
  { value: "SCREEN", label: "Screen" },
  { value: "OVERLAY", label: "Overlay" },
  { value: "DARKEN", label: "Darken" },
  { value: "LIGHTEN", label: "Lighten" },
  { value: "COLOR_DODGE", label: "Color dodge" },
  { value: "COLOR_BURN", label: "Color burn" },
  { value: "HARD_LIGHT", label: "Hard light" },
  { value: "SOFT_LIGHT", label: "Soft light" },
  { value: "DIFFERENCE", label: "Difference" },
  { value: "EXCLUSION", label: "Exclusion" },
  { value: "HUE", label: "Hue" },
  { value: "SATURATION", label: "Saturation" },
  { value: "COLOR", label: "Color" },
  { value: "LUMINOSITY", label: "Luminosity" },
];

const effectItemStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "4px 0",
};

const effectHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const effectControlsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 4,
};

const emptyStyle: CSSProperties = {
  fontSize: fontTokens.size.md,
  color: colorTokens.text.tertiary,
};

function effectLabel(type: EffectTypeId): string {
  switch (type) {
    case "DROP_SHADOW":
      return "Drop Shadow";
    case "INNER_SHADOW":
      return "Inner Shadow";
    case "FOREGROUND_BLUR":
      return "Layer Blur";
    case "BACKGROUND_BLUR":
      return "Background Blur";
  }
}

/** Renders the effect list (drop/inner shadow, layer/background blur) with shadow detail controls. */
export function EffectsSectionView({ effects, onAdd, onRemove, onChange }: EffectsSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {effects.length === 0 && <div style={emptyStyle}>No effects</div>}
      {effects.map((effect, i) => {
        const isShadow = effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW";
        const label = effectLabel(effect.type);

        return (
          <div key={i} style={{ ...effectItemStyle, opacity: effect.visible ? 1 : 0.4 }}>
            <div style={effectHeaderStyle}>
              <Toggle
                checked={effect.visible}
                onChange={(checked) => onChange(i, { ...effect, visible: checked })}
                ariaLabel={`Effect visible ${i + 1}`}
              />
              <Select<EffectTypeId>
                value={effect.type}
                onChange={(type) => onChange(i, { ...effect, type })}
                options={EFFECT_TYPE_OPTIONS}
                ariaLabel={`Effect type ${i + 1}`}
              />
              <button type="button" title="Remove effect" onClick={() => onRemove(i)} style={removeButtonStyle}>
                <CloseIcon size={12} />
              </button>
            </div>
            <div style={effectControlsStyle}>
              <Input
                type="number"
                ariaLabel={`${label} radius`}
                value={effect.radius}
                onChange={(v) => onChange(i, { ...effect, radius: v as number })}
                suffix="r"
              />
              {isShadow && (
                <>
                  <Select<BlendModeId>
                    value={effect.blendMode}
                    onChange={(blendMode) => onChange(i, { ...effect, blendMode })}
                    options={BLEND_MODE_OPTIONS}
                    ariaLabel={`${label} blend mode`}
                  />
                  <Input
                    type="number"
                    ariaLabel={`${label} offset x`}
                    value={effect.offsetX}
                    onChange={(v) => onChange(i, { ...effect, offsetX: v as number })}
                    suffix="x"
                  />
                  <Input
                    type="number"
                    ariaLabel={`${label} offset y`}
                    value={effect.offsetY}
                    onChange={(v) => onChange(i, { ...effect, offsetY: v as number })}
                    suffix="y"
                  />
                  <Input
                    type="number"
                    ariaLabel={`${label} spread`}
                    value={effect.spread}
                    onChange={(v) => onChange(i, { ...effect, spread: v as number })}
                    suffix="s"
                  />
                  <input
                    type="color"
                    value={effect.hex}
                    aria-label={`${label} color`}
                    onChange={(e) => onChange(i, { ...effect, hex: e.target.value })}
                    style={{ width: "100%", height: 28, padding: 0, border: `1px solid ${colorTokens.border.strong}`, borderRadius: 4 }}
                  />
                  <Input
                    type="number"
                    ariaLabel={`${label} opacity`}
                    value={Math.round(effect.opacity * 100)}
                    min={0}
                    max={100}
                    onChange={(v) => onChange(i, { ...effect, opacity: (v as number) / 100 })}
                    suffix="%"
                  />
                  <Toggle
                    checked={effect.showShadowBehindNode}
                    onChange={(checked) => onChange(i, { ...effect, showShadowBehindNode: checked })}
                    label="Behind"
                    ariaLabel={`${label} show behind node`}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={onAdd} style={addButtonStyle}>
        <AddIcon size={12} />
        Add effect
      </button>
    </div>
  );
}
