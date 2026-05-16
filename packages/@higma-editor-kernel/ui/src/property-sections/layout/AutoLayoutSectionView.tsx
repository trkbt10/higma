/**
 * @file Auto layout view (presentational only)
 *
 * Renders controls for stack mode, gap, padding, alignment, wrap and Z-order.
 * Numeric inputs use prefix-label + unit-suffix layout: the role letter
 * (G, CG, T, R, B, L) is the leading prefix (and Figma-style drag scrubber);
 * the trailing `px` suffix is the unit. Enum selectors keep Select dropdowns
 * because they have no numeric value to attach a unit to.
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
            <Input
              type="number"
              ariaLabel="Auto layout gap"
              value={gap}
              prefix="G"
              suffix="px"
              dragToChange
              onChange={(v) => onGapChange(v as number)}
            />
            <Input
              type="number"
              ariaLabel="Auto layout counter gap"
              value={counterGap}
              prefix="CG"
              suffix="px"
              dragToChange
              onChange={(v) => onCounterGapChange(v as number)}
            />
          </FieldRow>
          <FieldRow>
            <Input
              type="number"
              ariaLabel="Auto layout padding top"
              value={padding.top}
              prefix="T"
              suffix="px"
              dragToChange
              onChange={(v) => onPaddingChange("top", v as number)}
            />
            <Input
              type="number"
              ariaLabel="Auto layout padding right"
              value={padding.right}
              prefix="R"
              suffix="px"
              dragToChange
              onChange={(v) => onPaddingChange("right", v as number)}
            />
          </FieldRow>
          <FieldRow>
            <Input
              type="number"
              ariaLabel="Auto layout padding bottom"
              value={padding.bottom}
              prefix="B"
              suffix="px"
              dragToChange
              onChange={(v) => onPaddingChange("bottom", v as number)}
            />
            <Input
              type="number"
              ariaLabel="Auto layout padding left"
              value={padding.left}
              prefix="L"
              suffix="px"
              dragToChange
              onChange={(v) => onPaddingChange("left", v as number)}
            />
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
            <Toggle checked={wrap} onChange={onWrapChange} label="Wrap" />
            <Toggle checked={reverseZ} onChange={onReverseZChange} label="Reverse Z" />
          </FieldRow>
        </>
      )}
    </div>
  );
}
