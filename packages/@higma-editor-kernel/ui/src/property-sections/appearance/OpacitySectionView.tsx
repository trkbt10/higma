/**
 * @file Opacity property section view (presentational only)
 *
 * Renders a single 0-100 % input. The section title surrounding this view
 * already conveys "Opacity" so no prefix label is needed; the suffix is the
 * `%` unit, and the digit area itself acts as the drag-to-change scrubber
 * via the Input primitive's internal drag handling.
 */

import { Input } from "../../primitives";

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
    <Input
      type="number"
      ariaLabel="Opacity"
      value={percent}
      min={0}
      max={100}
      step={1}
      suffix="%"
      dragToChange
      disabled={disabled}
      onChange={(value) => onPercentChange(value as number)}
    />
  );
}
