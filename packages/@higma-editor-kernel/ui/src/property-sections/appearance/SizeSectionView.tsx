/**
 * @file Size section view (presentational only)
 *
 * Pure W/H size editor. Separated from Position because size behaviour
 * changes based on AutoLayout context: when the parent is an AutoLayout
 * container, each axis grows a sizing-mode chooser (Fixed / Hug / Fill) on
 * the trailing slot. Consumers pass `widthSuffix` / `heightSuffix` to
 * inject a SuffixSelect for that mode; when omitted, the static `px` unit
 * is shown.
 */

import type { ReactNode } from "react";
import { Input } from "../../primitives";
import { FieldRow } from "../../layout";

export type SizeSectionField = "w" | "h";

export type SizeSectionViewProps = {
  readonly width: number;
  readonly height: number;
  readonly onChange: (field: SizeSectionField, value: number) => void;
  /** Replace the static `px` suffix on W — typically a SuffixSelect for sizing mode. */
  readonly widthSuffix?: ReactNode;
  /** Replace the static `px` suffix on H — typically a SuffixSelect for sizing mode. */
  readonly heightSuffix?: ReactNode;
  readonly disabled?: boolean;
};

/** Renders W/H size inputs with prefix-label and pluggable suffix (default `px`). */
export function SizeSectionView({
  width,
  height,
  onChange,
  widthSuffix,
  heightSuffix,
  disabled,
}: SizeSectionViewProps) {
  return (
    <FieldRow>
      <Input
        type="number"
        ariaLabel="Width"
        value={width}
        min={0}
        prefix="W"
        suffix={widthSuffix ?? "px"}
        dragToChange
        disabled={disabled}
        onChange={(value) => onChange("w", value as number)}
      />
      <Input
        type="number"
        ariaLabel="Height"
        value={height}
        min={0}
        prefix="H"
        suffix={heightSuffix ?? "px"}
        dragToChange
        disabled={disabled}
        onChange={(value) => onChange("h", value as number)}
      />
    </FieldRow>
  );
}
