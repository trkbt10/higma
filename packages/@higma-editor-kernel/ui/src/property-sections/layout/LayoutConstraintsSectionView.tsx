/**
 * @file Layout constraints view (presentational only)
 *
 * Renders controls for stack positioning, primary/counter sizing, horizontal
 * and vertical constraints, align-self and grow. The "Grow" numeric input is
 * Number-with-Suffix; the enum-only fields (positioning, sizing, alignment)
 * keep their Select dropdowns because they carry no associated number.
 */

import { Input, Select } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";
import type { SelectOption } from "../../types";
import { ConstraintAnchorGrid } from "../../operations";

export type StackPositioningId = "AUTO" | "ABSOLUTE";
export type StackSizingId = "FIXED" | "RESIZE_TO_FIT" | "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE";
export type ConstraintTypeId = "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
export type StackCounterAlignId = "MIN" | "CENTER" | "MAX" | "STRETCH" | "BASELINE";

export type LayoutConstraintsSectionViewProps = {
  readonly positioning: StackPositioningId;
  readonly primarySizing: StackSizingId;
  readonly counterSizing: StackSizingId;
  readonly horizontalConstraint: ConstraintTypeId;
  readonly verticalConstraint: ConstraintTypeId;
  readonly alignSelf: StackCounterAlignId;
  readonly grow: number;
  readonly onPositioningChange: (value: StackPositioningId) => void;
  readonly onPrimarySizingChange: (value: StackSizingId) => void;
  readonly onCounterSizingChange: (value: StackSizingId) => void;
  readonly onHorizontalConstraintChange: (value: ConstraintTypeId) => void;
  readonly onVerticalConstraintChange: (value: ConstraintTypeId) => void;
  readonly onAlignSelfChange: (value: StackCounterAlignId) => void;
  readonly onGrowChange: (value: number) => void;
};

export const POSITIONING_OPTIONS: readonly SelectOption<StackPositioningId>[] = [
  { value: "AUTO", label: "Auto" },
  { value: "ABSOLUTE", label: "Absolute" },
];

export const SIZING_OPTIONS: readonly SelectOption<StackSizingId>[] = [
  { value: "FIXED", label: "Fixed" },
  { value: "RESIZE_TO_FIT", label: "Hug" },
  { value: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE", label: "Implicit hug" },
];

export const CONSTRAINT_OPTIONS: readonly SelectOption<ConstraintTypeId>[] = [
  { value: "MIN", label: "Min" },
  { value: "CENTER", label: "Center" },
  { value: "MAX", label: "Max" },
  { value: "STRETCH", label: "Stretch" },
  { value: "SCALE", label: "Scale" },
];

export const ALIGN_SELF_OPTIONS: readonly SelectOption<StackCounterAlignId>[] = [
  { value: "MIN", label: "Auto" },
  { value: "CENTER", label: "Center" },
  { value: "MAX", label: "Max" },
  { value: "STRETCH", label: "Stretch" },
  { value: "BASELINE", label: "Baseline" },
];

/** Renders stack positioning/sizing/constraint/align-self/grow inputs. */
export function LayoutConstraintsSectionView({
  positioning,
  primarySizing,
  counterSizing,
  horizontalConstraint,
  verticalConstraint,
  alignSelf,
  grow,
  onPositioningChange,
  onPrimarySizingChange,
  onCounterSizingChange,
  onHorizontalConstraintChange,
  onVerticalConstraintChange,
  onAlignSelfChange,
  onGrowChange,
}: LayoutConstraintsSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldGroup label="Position">
        <Select value={positioning} onChange={onPositioningChange} options={POSITIONING_OPTIONS} ariaLabel="Layout position" />
      </FieldGroup>
      <FieldRow>
        <FieldGroup label="Primary fit" inline labelWidth={70}>
          <Select value={primarySizing} onChange={onPrimarySizingChange} options={SIZING_OPTIONS} ariaLabel="Layout primary fit" />
        </FieldGroup>
        <FieldGroup label="Counter fit" inline labelWidth={70}>
          <Select value={counterSizing} onChange={onCounterSizingChange} options={SIZING_OPTIONS} ariaLabel="Layout counter fit" />
        </FieldGroup>
      </FieldRow>
      <FieldRow>
        <FieldGroup label="Align self" inline labelWidth={70}>
          <Select value={alignSelf} onChange={onAlignSelfChange} options={ALIGN_SELF_OPTIONS} ariaLabel="Layout align self" />
        </FieldGroup>
        <Input
          type="number"
          ariaLabel="Layout grow"
          value={grow}
          prefix="G"
          dragToChange
          onChange={(v) => onGrowChange(v as number)}
        />
      </FieldRow>
      {positioning === "ABSOLUTE" && (
        <FieldRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <FieldGroup label="Horizontal" inline labelWidth={70}>
              <Select value={horizontalConstraint} onChange={onHorizontalConstraintChange} options={CONSTRAINT_OPTIONS} ariaLabel="Layout horizontal constraint" />
            </FieldGroup>
            <FieldGroup label="Vertical" inline labelWidth={70}>
              <Select value={verticalConstraint} onChange={onVerticalConstraintChange} options={CONSTRAINT_OPTIONS} ariaLabel="Layout vertical constraint" />
            </FieldGroup>
          </div>
          <ConstraintAnchorGrid
            horizontal={horizontalConstraint}
            vertical={verticalConstraint}
            onChange={({ horizontal, vertical }) => {
              if (horizontal !== horizontalConstraint) {
                onHorizontalConstraintChange(horizontal);
              }
              if (vertical !== verticalConstraint) {
                onVerticalConstraintChange(vertical);
              }
            }}
          />
        </FieldRow>
      )}
    </div>
  );
}
