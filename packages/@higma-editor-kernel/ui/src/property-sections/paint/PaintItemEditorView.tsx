/** @file Paint item editor view (presentational only). */

import { Input, Select } from "../../primitives";
import { CloseIcon } from "../../icons";
import type { SelectOption } from "../../types";
import { IMAGE_SCALE_MODE_OPTIONS, PAINT_TYPE_OPTIONS } from "./paint-options";
import { GradientPaintControlsView } from "./GradientPaintControlsView";
import {
  paintRowStyle,
  paintHeaderStyle,
  paintInlineStyle,
  swatchStyle,
  hexStyle,
  removeButtonStyle,
  addButtonStyle,
} from "./paint-section-styles";
import type {
  GradientHandleView,
  GradientStopView,
  ImageScaleModeId,
  PaintItemView,
  PaintTypeId,
} from "./paint-view-model";

export type PaintItemImageOption = { readonly value: string; readonly label: string };

export type PaintItemEditorViewProps = {
  readonly paint: PaintItemView;
  readonly index: number;
  readonly labelPrefix: string;
  readonly imageOptions: readonly PaintItemImageOption[];
  readonly onTypeChange: (index: number, type: PaintTypeId) => void;
  readonly onOpacityChange: (index: number, opacity: number) => void;
  readonly onColorChange: (index: number, hex: string) => void;
  readonly onImageRefChange: (index: number, imageRef: string) => void;
  readonly onImageScaleModeChange: (index: number, scaleMode: ImageScaleModeId) => void;
  readonly onImageScaleChange: (index: number, scale: number) => void;
  readonly onImageRotationChange: (index: number, rotationDeg: number) => void;
  readonly onStartImageUpload: (index: number) => void;
  readonly onGradientStopChange: (index: number, stopIndex: number, stop: GradientStopView) => void;
  readonly onAddGradientStop: (index: number) => void;
  readonly onRemoveGradientStop: (index: number, stopIndex: number) => void;
  readonly onGradientHandleChange: (index: number, handleIndex: number, handle: GradientHandleView) => void;
  readonly onRemove: (index: number) => void;
};

const paintTypeOptions: readonly SelectOption<PaintTypeId>[] = PAINT_TYPE_OPTIONS;

/** Renders a single paint editor row (type, color/gradient/image, opacity, remove). */
export function PaintItemEditorView({
  paint,
  index,
  labelPrefix,
  imageOptions,
  onTypeChange,
  onOpacityChange,
  onColorChange,
  onImageRefChange,
  onImageScaleModeChange,
  onImageScaleChange,
  onImageRotationChange,
  onStartImageUpload,
  onGradientStopChange,
  onAddGradientStop,
  onRemoveGradientStop,
  onGradientHandleChange,
  onRemove,
}: PaintItemEditorViewProps) {
  const ordinal = index + 1;
  const isGradient = paint.type.startsWith("GRADIENT_");
  const isImage = paint.type === "IMAGE";

  return (
    <div style={paintRowStyle}>
      <div style={paintHeaderStyle}>
        <Select
          value={paint.type}
          onChange={(type) => onTypeChange(index, type)}
          options={paintTypeOptions}
          ariaLabel={`${labelPrefix} paint type ${ordinal}`}
        />
        <Input
          type="number"
          ariaLabel={`${labelPrefix} opacity ${ordinal}`}
          value={Math.round(paint.opacity * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => onOpacityChange(index, (v as number) / 100)}
          width={64}
          suffix="%"
        />
        <button
          type="button"
          style={removeButtonStyle}
          onClick={() => onRemove(index)}
          title={`Remove ${labelPrefix.toLowerCase()}`}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {!isImage && !isGradient && (
        <div style={paintInlineStyle}>
          <input
            aria-label={`${labelPrefix} color ${ordinal}`}
            type="color"
            value={paint.hex}
            onChange={(event) => onColorChange(index, event.target.value)}
            style={swatchStyle}
          />
          <span style={hexStyle}>{paint.hex.toUpperCase()}</span>
        </div>
      )}
      {isGradient && paint.gradient && (
        <GradientPaintControlsView
          labelPrefix={labelPrefix}
          paintIndex={index}
          stops={paint.gradient.stops}
          handles={paint.gradient.handles}
          onStopChange={(stopIndex, stop) => onGradientStopChange(index, stopIndex, stop)}
          onAddStop={() => onAddGradientStop(index)}
          onRemoveStop={(stopIndex) => onRemoveGradientStop(index, stopIndex)}
          onHandleChange={(handleIndex, handle) => onGradientHandleChange(index, handleIndex, handle)}
        />
      )}
      {isImage && paint.image && (
        <>
          <div style={paintInlineStyle}>
            <Select
              value={paint.image.imageRef}
              onChange={(value) => onImageRefChange(index, value)}
              options={imageOptions}
              ariaLabel={`${labelPrefix} image ${ordinal}`}
            />
            <button type="button" style={addButtonStyle} onClick={() => onStartImageUpload(index)}>
              Upload image
            </button>
          </div>
          <div style={paintInlineStyle}>
            <Select
              value={paint.image.scaleMode}
              onChange={(value) => onImageScaleModeChange(index, value)}
              options={IMAGE_SCALE_MODE_OPTIONS}
              ariaLabel={`${labelPrefix} image scale mode ${ordinal}`}
            />
            <Input
              type="number"
              ariaLabel={`${labelPrefix} image scale ${ordinal}`}
              value={paint.image.scale}
              min={0}
              step={0.05}
              prefix="Scale"
              suffix="x"
              dragToChange
              dragStep={0.05}
              onChange={(v) => onImageScaleChange(index, v as number)}
              width={96}
            />
            <Input
              type="number"
              ariaLabel={`${labelPrefix} image rotation ${ordinal}`}
              value={Math.round(paint.image.rotationDeg)}
              step={1}
              prefix="Rot"
              suffix="°"
              dragToChange
              onChange={(v) => onImageRotationChange(index, v as number)}
              width={88}
            />
          </div>
        </>
      )}
    </div>
  );
}
