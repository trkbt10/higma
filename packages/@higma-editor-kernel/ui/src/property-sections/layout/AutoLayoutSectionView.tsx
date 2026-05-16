/**
 * @file Auto layout view (presentational only)
 *
 * Renders controls for stack mode, gap, padding, alignment, wrap and Z-order.
 * Uses string enums (StackModeId / StackAlignId) defined in this file. Callers
 * map between their domain enums (e.g. fig Kiwi KiwiEnumValue) and these ids.
 */

import { Input, Select, Toggle } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";
import type { SelectOption } from "../../types";

export type StackModeId = "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
export type StackAlignId = "MIN" | "CENTER" | "MAX" | "BASELINE";

export type AutoLayoutPadding = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type AutoLayoutPaddingSide = keyof AutoLayoutPadding;

export type AutoLayoutSectionViewProps = {
  readonly mode: StackModeId;
  readonly gap: number;
  readonly padding: AutoLayoutPadding;
  readonly primaryAlign: StackAlignId;
  readonly counterAlign: StackAlignId;
  readonly alignContent: StackAlignId;
  readonly counterGap: number;
  readonly wrap: boolean;
  readonly reverseZ: boolean;
  readonly onModeChange: (mode: StackModeId) => void;
  readonly onGapChange: (value: number) => void;
  readonly onPaddingChange: (side: AutoLayoutPaddingSide, value: number) => void;
  readonly onPrimaryAlignChange: (align: StackAlignId) => void;
  readonly onCounterAlignChange: (align: StackAlignId) => void;
  readonly onAlignContentChange: (align: StackAlignId) => void;
  readonly onCounterGapChange: (value: number) => void;
  readonly onWrapChange: (value: boolean) => void;
  readonly onReverseZChange: (value: boolean) => void;
};

export const STACK_MODE_OPTIONS: readonly SelectOption<StackModeId>[] = [
  { value: "NONE", label: "None" },
  { value: "HORIZONTAL", label: "Horizontal" },
  { value: "VERTICAL", label: "Vertical" },
  { value: "GRID", label: "Grid" },
];

export const STACK_ALIGN_OPTIONS: readonly SelectOption<StackAlignId>[] = [
  { value: "MIN", label: "Min" },
  { value: "CENTER", label: "Center" },
  { value: "MAX", label: "Max" },
  { value: "BASELINE", label: "Baseline" },
];

/** Renders auto-layout mode, gap, padding, alignment, wrap and Z-order controls. */
export function AutoLayoutSectionView({
  mode,
  gap,
  padding,
  primaryAlign,
  counterAlign,
  alignContent,
  counterGap,
  wrap,
  reverseZ,
  onModeChange,
  onGapChange,
  onPaddingChange,
  onPrimaryAlignChange,
  onCounterAlignChange,
  onAlignContentChange,
  onCounterGapChange,
  onWrapChange,
  onReverseZChange,
}: AutoLayoutSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldGroup label="Mode">
        <Select value={mode} onChange={onModeChange} options={STACK_MODE_OPTIONS} ariaLabel="Auto layout mode" />
      </FieldGroup>
      {mode !== "NONE" && (
        <>
          <FieldRow>
            <FieldGroup label="Gap" inline labelWidth={40}>
              <Input type="number" ariaLabel="Auto layout gap" value={gap} onChange={(v) => onGapChange(v as number)} />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Top" inline labelWidth={28}>
              <Input type="number" ariaLabel="Auto layout padding top" value={padding.top} onChange={(v) => onPaddingChange("top", v as number)} />
            </FieldGroup>
            <FieldGroup label="Right" inline labelWidth={36}>
              <Input type="number" ariaLabel="Auto layout padding right" value={padding.right} onChange={(v) => onPaddingChange("right", v as number)} />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Bottom" inline labelWidth={44}>
              <Input type="number" ariaLabel="Auto layout padding bottom" value={padding.bottom} onChange={(v) => onPaddingChange("bottom", v as number)} />
            </FieldGroup>
            <FieldGroup label="Left" inline labelWidth={28}>
              <Input type="number" ariaLabel="Auto layout padding left" value={padding.left} onChange={(v) => onPaddingChange("left", v as number)} />
            </FieldGroup>
          </FieldRow>
          <FieldGroup label="Primary align">
            <Select value={primaryAlign} onChange={onPrimaryAlignChange} options={STACK_ALIGN_OPTIONS} ariaLabel="Auto layout primary align" />
          </FieldGroup>
          <FieldGroup label="Counter align">
            <Select value={counterAlign} onChange={onCounterAlignChange} options={STACK_ALIGN_OPTIONS} ariaLabel="Auto layout counter align" />
          </FieldGroup>
          <FieldGroup label="Align content">
            <Select value={alignContent} onChange={onAlignContentChange} options={STACK_ALIGN_OPTIONS} ariaLabel="Auto layout align content" />
          </FieldGroup>
          <FieldRow>
            <FieldGroup label="Counter gap" inline labelWidth={78}>
              <Input type="number" ariaLabel="Auto layout counter gap" value={counterGap} onChange={(v) => onCounterGapChange(v as number)} />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <Toggle checked={wrap} onChange={onWrapChange} label="Wrap" />
            <Toggle checked={reverseZ} onChange={onReverseZChange} label="Reverse Z" />
          </FieldRow>
        </>
      )}
    </div>
  );
}
