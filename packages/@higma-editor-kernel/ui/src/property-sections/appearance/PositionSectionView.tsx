/**
 * @file Position section view (presentational only)
 *
 * Pure X/Y position editor. Separated from Size because the two have
 * independent contexts: position remains a 2D coordinate even when the parent
 * is an AutoLayout container (Figma still shows X/Y while sizing flips into
 * Fixed/Hug/Fill mode), so a single combined "Transform" section would have
 * conflicting layout rules.
 */

import { Input } from "../../primitives";
import { FieldRow } from "../../layout";

export type PositionSectionField = "x" | "y";

export type PositionSectionViewProps = {
  readonly x: number;
  readonly y: number;
  readonly onChange: (field: PositionSectionField, value: number) => void;
  readonly disabled?: boolean;
};

/** Renders X/Y position inputs with prefix-label + px suffix. */
export function PositionSectionView({ x, y, onChange, disabled }: PositionSectionViewProps) {
  return (
    <FieldRow>
      <Input
        type="number"
        ariaLabel="X"
        value={x}
        prefix="X"
        suffix="px"
        dragToChange
        disabled={disabled}
        onChange={(value) => onChange("x", value as number)}
      />
      <Input
        type="number"
        ariaLabel="Y"
        value={y}
        prefix="Y"
        suffix="px"
        dragToChange
        disabled={disabled}
        onChange={(value) => onChange("y", value as number)}
      />
    </FieldRow>
  );
}
