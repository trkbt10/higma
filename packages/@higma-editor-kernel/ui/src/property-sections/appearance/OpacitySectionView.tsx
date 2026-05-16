/**
 * @file Opacity property section view (presentational only)
 *
 * Pure view that renders an opacity input expecting 0-100 percent.
 * Consumers (fig editor, other document editors) compute the percent from
 * their domain model and supply an `onPercentChange` handler.
 */

import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";

export type OpacitySectionViewProps = {
  /** Current opacity expressed as 0-100 percent. */
  readonly percent: number;
  /** Fires with a 0-100 percent value (already clamped by the caller if needed). */
  readonly onPercentChange: (percent: number) => void;
  /** Disable input (e.g. when document is read-only). */
  readonly disabled?: boolean;
};

/** Renders a single 0-100 percent opacity input. */
export function OpacitySectionView({ percent, onPercentChange, disabled }: OpacitySectionViewProps) {
  return (
    <FieldRow>
      <FieldGroup label="Opacity" inline labelWidth={50}>
        <Input
          type="number"
          value={percent}
          min={0}
          max={100}
          step={1}
          suffix="%"
          disabled={disabled}
          onChange={(value) => onPercentChange(value as number)}
          width={80}
        />
      </FieldGroup>
    </FieldRow>
  );
}
