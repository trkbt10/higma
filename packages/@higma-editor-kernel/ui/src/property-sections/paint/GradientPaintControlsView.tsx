/** @file Gradient paint controls view (presentational only). */

import type { CSSProperties } from "react";
import { Input } from "../../primitives";
import { AddIcon, CloseIcon } from "../../icons";
import {
  paintInlineStyle,
  swatchStyle,
  addButtonStyle,
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

const stopRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr) 58px 58px 22px",
  alignItems: "center",
  gap: 4,
  width: "100%",
};

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
      <button
        type="button"
        aria-label={`${controlLabel} add stop ${ordinal}`}
        style={addButtonStyle}
        onClick={onAddStop}
      >
        <AddIcon size={12} />
        Add stop
      </button>
      <div style={paintInlineStyle}>
        {handles.map((handle, handleIndex) => (
          <span key={handleIndex} style={{ display: "contents" }}>
            <Input
              type="number"
              ariaLabel={`${controlLabel} handle ${handleIndex + 1} x ${ordinal}`}
              value={roundPercent(handle.x)}
              min={-200}
              max={200}
              step={1}
              suffix="x"
              width={64}
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
              suffix="y"
              width={64}
              onChange={(value) => onHandleChange(handleIndex, {
                ...handle,
                y: (value as number) / 100,
              })}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
