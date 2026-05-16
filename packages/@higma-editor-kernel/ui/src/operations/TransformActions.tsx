/**
 * @file TransformActions — multi-operation primitive
 *
 * Three quick transform action buttons: rotate-CW, flip-horizontal, and
 * flip-vertical. Mirrors the icon button trio next to the rotation input in
 * Figma's Position panel.
 *
 * Each handler is optional; a button is rendered only when its handler is
 * provided so consumers can omit operations their domain does not support
 * (e.g. text nodes that cannot be flipped).
 */

import type { CSSProperties } from "react";
import { IconButton } from "../primitives";
import { RotateCwIcon, FlipHorizontalIcon, FlipVerticalIcon } from "../icons";

export type TransformActionsProps = {
  /** Handler for rotate ±90° (caller decides direction; conventional CW). */
  readonly onRotateCW?: () => void;
  /** Handler for horizontal flip (mirror across the vertical axis). */
  readonly onFlipHorizontal?: () => void;
  /** Handler for vertical flip (mirror across the horizontal axis). */
  readonly onFlipVertical?: () => void;
  readonly disabled?: boolean;
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
};

const ICON_SIZE = 14;

/** Quick transform actions: rotate / flip H / flip V. */
export function TransformActions({
  onRotateCW,
  onFlipHorizontal,
  onFlipVertical,
  disabled,
}: TransformActionsProps) {
  if (!onRotateCW && !onFlipHorizontal && !onFlipVertical) {
    return null;
  }
  return (
    <div style={rowStyle} role="group" aria-label="Transform actions">
      {onRotateCW && (
        <IconButton
          icon={<RotateCwIcon size={ICON_SIZE} />}
          ariaLabel="Rotate 90 degrees clockwise"
          size="sm"
          disabled={disabled}
          onClick={onRotateCW}
        />
      )}
      {onFlipHorizontal && (
        <IconButton
          icon={<FlipHorizontalIcon size={ICON_SIZE} />}
          ariaLabel="Flip horizontal"
          size="sm"
          disabled={disabled}
          onClick={onFlipHorizontal}
        />
      )}
      {onFlipVertical && (
        <IconButton
          icon={<FlipVerticalIcon size={ICON_SIZE} />}
          ariaLabel="Flip vertical"
          size="sm"
          disabled={disabled}
          onClick={onFlipVertical}
        />
      )}
    </div>
  );
}
