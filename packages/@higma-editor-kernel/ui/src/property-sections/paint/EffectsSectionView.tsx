/** @file Effects section view (presentational only). */

import { type CSSProperties } from "react";
import { Input, Select, Toggle } from "../../primitives";
import type { SelectOption } from "../../types";
import { colorTokens, fontTokens } from "../../design-tokens";
import { CloseIcon } from "../../icons";
import { AddItemButton } from "../../primitives";
import { removeButtonStyle } from "./paint-section-styles";

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

/**
 * Effect card layout.
 *
 * Each effect is presented as a card so that two adjacent shadows are
 * visually distinct (the previous layout let the cards bleed into each
 * other and forced operators to reverse-engineer which control belonged
 * to which effect). A 1px bottom border keeps the section compact while
 * still drawing the boundary.
 */
const effectItemStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  paddingBottom: 8,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const effectItemLastStyle: CSSProperties = {
  ...effectItemStyle,
  paddingBottom: 0,
  borderBottom: "none",
};

const effectHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

/**
 * Three-column control grid for shadow detail rows.
 *
 * Column 1 is a written row label ("Opacity", "Offset", "Blur",
 * "Spread") so the role of each numeric field is discoverable without
 * already knowing the single-letter prefix convention. Columns 2 and 3
 * hold the inputs themselves: X/Y for offset (universal coordinate
 * axes, scoped under "Offset"), a single span-2 input for the others.
 *
 * The previous layout used a 2-col grid where each cell carried only a
 * single-letter prefix ("O" / "R" / "S") — first-time operators had to
 * guess whether "O" meant Offset / Opacity / Orange. The new layout
 * gives the same horizontal information density (3 grid lanes) but
 * makes the field role read directly off the panel.
 */
const effectControlsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(56px, max-content) minmax(0, 1fr) minmax(0, 1fr)",
  rowGap: 6,
  columnGap: 6,
  alignItems: "center",
};

const fullWidthCellStyle: CSSProperties = {
  gridColumn: "1 / -1",
};

const spanInputsCellStyle: CSSProperties = {
  gridColumn: "2 / -1",
};

const rowLabelStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.primary,
  fontWeight: fontTokens.weight.medium,
  whiteSpace: "nowrap",
};

const colorRowStyle: CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

const colorSwatchStyle: CSSProperties = {
  width: 24,
  height: 24,
  flexShrink: 0,
  border: `1px solid ${colorTokens.border.strong}`,
  borderRadius: 4,
  padding: 0,
  cursor: "pointer",
};

const colorHexLabelStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.primary,
  letterSpacing: "0.02em",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
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

type EffectDetailRenderArgs = {
  readonly effect: EffectView;
  readonly index: number;
  readonly label: string;
  readonly onChange: (index: number, effect: EffectView) => void;
};

function renderShadowDetails({ effect, index, label, onChange }: EffectDetailRenderArgs) {
  const i = index;
  return (
    <div style={effectControlsStyle}>
      <div style={colorRowStyle}>
        <input
          type="color"
          value={effect.hex}
          aria-label={`${label} color`}
          onChange={(e) => onChange(i, { ...effect, hex: e.target.value })}
          style={colorSwatchStyle}
        />
        <span style={colorHexLabelStyle}>{effect.hex.toUpperCase()}</span>
      </div>
      <span style={rowLabelStyle}>Opacity</span>
      <div style={spanInputsCellStyle}>
        <Input
          type="number"
          ariaLabel={`${label} opacity`}
          value={Math.round(effect.opacity * 100)}
          min={0}
          max={100}
          onChange={(v) => onChange(i, { ...effect, opacity: (v as number) / 100 })}
          suffix="%"
          dragToChange
        />
      </div>
      <span style={rowLabelStyle}>Offset</span>
      <Input
        type="number"
        ariaLabel={`${label} offset x`}
        value={effect.offsetX}
        onChange={(v) => onChange(i, { ...effect, offsetX: v as number })}
        prefix="X"
        suffix="px"
        dragToChange
      />
      <Input
        type="number"
        ariaLabel={`${label} offset y`}
        value={effect.offsetY}
        onChange={(v) => onChange(i, { ...effect, offsetY: v as number })}
        prefix="Y"
        suffix="px"
        dragToChange
      />
      <span style={rowLabelStyle}>Blur</span>
      <div style={spanInputsCellStyle}>
        <Input
          type="number"
          ariaLabel={`${label} radius`}
          value={effect.radius}
          min={0}
          onChange={(v) => onChange(i, { ...effect, radius: v as number })}
          suffix="px"
          dragToChange
        />
      </div>
      <span style={rowLabelStyle}>Spread</span>
      <div style={spanInputsCellStyle}>
        <Input
          type="number"
          ariaLabel={`${label} spread`}
          value={effect.spread}
          onChange={(v) => onChange(i, { ...effect, spread: v as number })}
          suffix="px"
          dragToChange
        />
      </div>
      <div style={fullWidthCellStyle}>
        <Select<BlendModeId>
          value={effect.blendMode}
          onChange={(blendMode) => onChange(i, { ...effect, blendMode })}
          options={BLEND_MODE_OPTIONS}
          ariaLabel={`${label} blend mode`}
        />
      </div>
      <div style={fullWidthCellStyle}>
        <Toggle
          checked={effect.showShadowBehindNode}
          onChange={(checked) => onChange(i, { ...effect, showShadowBehindNode: checked })}
          label="Show behind node"
          ariaLabel={`${label} show behind node`}
        />
      </div>
    </div>
  );
}

function renderBlurDetails({ effect, index, label, onChange }: EffectDetailRenderArgs) {
  return (
    <Input
      type="number"
      ariaLabel={`${label} radius`}
      value={effect.radius}
      min={0}
      onChange={(v) => onChange(index, { ...effect, radius: v as number })}
      prefix="Radius"
      suffix="px"
      dragToChange
    />
  );
}

function renderEffectDetails(args: EffectDetailRenderArgs, isShadow: boolean) {
  if (isShadow) {
    return renderShadowDetails(args);
  }
  return renderBlurDetails(args);
}

function effectItemStyleFor(visible: boolean, isLast: boolean): CSSProperties {
  const base = isLast ? effectItemLastStyle : effectItemStyle;
  return { ...base, opacity: visible ? 1 : 0.4 };
}

/** Renders the effect list (drop/inner shadow, layer/background blur) with shadow detail controls. */
export function EffectsSectionView({ effects, onAdd, onRemove, onChange }: EffectsSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {effects.length === 0 && <div style={emptyStyle}>No effects</div>}
      {effects.map((effect, i) => {
        const isShadow = effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW";
        const label = effectLabel(effect.type);
        const isLast = i === effects.length - 1;

        return (
          <div key={i} style={effectItemStyleFor(effect.visible, isLast)}>
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
            {renderEffectDetails({ effect, index: i, label, onChange }, isShadow)}
          </div>
        );
      })}
      <AddItemButton label="Add effect" onClick={onAdd} />
    </div>
  );
}
