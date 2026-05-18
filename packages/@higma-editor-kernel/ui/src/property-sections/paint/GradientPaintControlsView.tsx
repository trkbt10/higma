/** @file Gradient paint controls view (presentational only). */

import type { CSSProperties } from "react";
import { Input } from "../../primitives";
import { CloseIcon } from "../../icons";
import { AddItemButton } from "../../primitives";
import { colorTokens, fontTokens } from "../../design-tokens";
import {
  swatchStyle,
  removeButtonStyle,
} from "./paint-section-styles";
import type { GradientStopView, GradientHandleView } from "./paint-view-model";

type GradientPaintControlsViewProps = {
  readonly labelPrefix: string;
  readonly paintIndex: number;
  readonly stops: readonly GradientStopView[];
  readonly handles: readonly GradientHandleView[];
  readonly onStopChange: (stopIndex: number, stop: GradientStopView) => void;
  readonly onAddStop: () => void;
  readonly onRemoveStop: (stopIndex: number) => void;
  readonly onHandleChange: (handleIndex: number, handle: GradientHandleView) => void;
};

/**
 * Stop row uses two equal-width number cells (Position / Opacity) so that
 * the digits remain legible at typical inspector widths (~240 px panel →
 * ~95 px per cell after swatch / remove / gaps). The columns are labelled
 * once by the header row above the list — putting single-letter prefixes
 * ("P" / "O") inside each input was opaque to first-time operators and
 * stole pixels from the digits.
 */
const stopRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr) minmax(0, 1fr) 22px",
  alignItems: "center",
  gap: 6,
  width: "100%",
};

const stopHeaderRowStyle: CSSProperties = {
  ...stopRowStyle,
  marginBottom: 2,
};

/**
 * Column headers for the gradient stop list. These are FUNCTIONAL —
 * they tell the operator which numeric column is Position vs Opacity.
 * Rendered in text.primary for AAA contrast (17.4:1 on the panel
 * background) rather than text.tertiary (2.64:1, would-be hint colour
 * that fails AAA and AA alike for functional labels).
 */
const stopHeaderLabelStyle: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: colorTokens.text.primary,
  textTransform: "uppercase",
  letterSpacing: fontTokens.letterSpacing.uppercase,
  fontWeight: fontTokens.weight.semibold,
  paddingLeft: 4,
};

/**
 * Handle controls used to live in a single flex row (six inputs wide), which
 * caused inputs to flex-shrink below the width needed for a 3-digit number
 * plus prefix/suffix chrome. The new layout dedicates one row per handle
 * with a written label so the two coordinates of each handle have room to
 * breathe — operationally you adjust handle N by name, not by guessing
 * which "X %" in a row of six belongs to which point.
 */
const handleRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(48px, max-content) minmax(0, 1fr) minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  width: "100%",
};

const handleLabelStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.primary,
  fontWeight: fontTokens.weight.medium,
  whiteSpace: "nowrap",
};

const HANDLE_LABELS = ["Start", "End", "Width", "Focal"] as const;

function handleLabel(index: number, total: number): string {
  if (index < HANDLE_LABELS.length) {
    return HANDLE_LABELS[index]!;
  }
  return `Handle ${index + 1} / ${total}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundPercent(value: number): number {
  return Math.round(value * 100);
}

/** Renders gradient stops and handle controls for a gradient paint. */
export function GradientPaintControlsView({
  labelPrefix,
  paintIndex,
  stops,
  handles,
  onStopChange,
  onAddStop,
  onRemoveStop,
  onHandleChange,
}: GradientPaintControlsViewProps) {
  const controlLabel = `${labelPrefix} gradient`;
  const ordinal = paintIndex + 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={stopHeaderRowStyle} aria-hidden="true">
        <span />
        <span style={stopHeaderLabelStyle}>Position</span>
        <span style={stopHeaderLabelStyle}>Opacity</span>
        <span />
      </div>
      {stops.map((stop, stopIndex) => (
        <div key={stopIndex} style={stopRowStyle}>
          <input
            aria-label={`${controlLabel} stop ${stopIndex + 1} color ${ordinal}`}
            type="color"
            value={stop.hex}
            onChange={(event) => onStopChange(stopIndex, { ...stop, hex: event.target.value })}
            style={swatchStyle}
          />
          <Input
            type="number"
            ariaLabel={`${controlLabel} stop ${stopIndex + 1} position ${ordinal}`}
            value={Math.round(stop.position * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            dragToChange
            onChange={(value) => onStopChange(stopIndex, {
              ...stop,
              position: clamp01((value as number) / 100),
            })}
          />
          <Input
            type="number"
            ariaLabel={`${controlLabel} stop ${stopIndex + 1} opacity ${ordinal}`}
            value={Math.round(stop.alpha * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            dragToChange
            onChange={(value) => onStopChange(stopIndex, {
              ...stop,
              alpha: clamp01((value as number) / 100),
            })}
          />
          <button
            type="button"
            aria-label={`${controlLabel} remove stop ${stopIndex + 1} ${ordinal}`}
            title="Remove gradient stop"
            style={removeButtonStyle}
            disabled={stops.length <= 2}
            onClick={() => onRemoveStop(stopIndex)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <AddItemButton
        label="Add stop"
        ariaLabel={`${controlLabel} add stop ${ordinal}`}
        onClick={onAddStop}
      />
      {handles.map((handle, handleIndex) => (
        <div key={handleIndex} style={handleRowStyle}>
          <span style={handleLabelStyle}>
            {handleLabel(handleIndex, handles.length)}
          </span>
          <Input
            type="number"
            ariaLabel={`${controlLabel} handle ${handleIndex + 1} x ${ordinal}`}
            value={roundPercent(handle.x)}
            min={-200}
            max={200}
            step={1}
            prefix="X"
            suffix="%"
            dragToChange
            onChange={(value) => onHandleChange(handleIndex, {
              ...handle,
              x: (value as number) / 100,
            })}
          />
          <Input
            type="number"
            ariaLabel={`${controlLabel} handle ${handleIndex + 1} y ${ordinal}`}
            value={roundPercent(handle.y)}
            min={-200}
            max={200}
            step={1}
            prefix="Y"
            suffix="%"
            dragToChange
            onChange={(value) => onHandleChange(handleIndex, {
              ...handle,
              y: (value as number) / 100,
            })}
          />
        </div>
      ))}
    </div>
  );
}
