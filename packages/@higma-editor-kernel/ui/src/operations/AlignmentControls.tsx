/**
 * @file AlignmentControls — single-operation primitive
 *
 * Emits "align selection within its parent" intents along an axis. Two
 * 3-button groups (horizontal: left/center/right, vertical: top/middle/bottom)
 * matching the Figma Position panel's Alignment row.
 *
 * The component is intentionally action-only: it does not track a "current"
 * alignment because alignment is an idempotent action, not a value. Consumers
 * decide what to do when a button is pressed (typically: snap the selection's
 * bounding box to the parent's edge or center on the chosen axis).
 */

import type { CSSProperties } from "react";
import { IconButton } from "../primitives";
import {
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignMiddleIcon,
  AlignBottomIcon,
} from "../icons";

export type AlignmentAxis = "horizontal" | "vertical";
export type AlignmentPosition = "start" | "center" | "end";

export type AlignmentControlsProps = {
  /** Fires once per button press with the axis and target position. */
  readonly onAlign: (axis: AlignmentAxis, position: AlignmentPosition) => void;
  /** Disable all buttons (e.g. when no parent reference frame is available). */
  readonly disabled?: boolean;
};

const groupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const ICON_SIZE = 14;

/** Renders the H+V alignment button bar from Figma's Position panel. */
export function AlignmentControls({ onAlign, disabled }: AlignmentControlsProps) {
  return (
    <div style={rowStyle}>
      <div style={groupStyle}>
        <IconButton
          icon={<AlignLeftIcon size={ICON_SIZE} />}
          ariaLabel="Align left within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("horizontal", "start")}
        />
        <IconButton
          icon={<AlignCenterIcon size={ICON_SIZE} />}
          ariaLabel="Align horizontal center within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("horizontal", "center")}
        />
        <IconButton
          icon={<AlignRightIcon size={ICON_SIZE} />}
          ariaLabel="Align right within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("horizontal", "end")}
        />
      </div>
      <div style={groupStyle}>
        <IconButton
          icon={<AlignTopIcon size={ICON_SIZE} />}
          ariaLabel="Align top within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("vertical", "start")}
        />
        <IconButton
          icon={<AlignMiddleIcon size={ICON_SIZE} />}
          ariaLabel="Align vertical middle within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("vertical", "center")}
        />
        <IconButton
          icon={<AlignBottomIcon size={ICON_SIZE} />}
          ariaLabel="Align bottom within parent"
          size="sm"
          disabled={disabled}
          onClick={() => onAlign("vertical", "end")}
        />
      </div>
    </div>
  );
}
