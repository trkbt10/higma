/** @file Shared paint item editor component for fill and stroke property sections. */

import type { FigImageScaleMode, FigPaint } from "@higma/fig/types";
import { Input } from "@higma/ui-components/primitives/Input";
import { Select } from "@higma/ui-components/primitives/Select";
import { CloseIcon } from "@higma/ui-components/icons";
import { imageScaleModeOptions, paintTypeOptions } from "./paint-options";
import { GradientPaintControls } from "./GradientPaintControls";
import { figColorToHex } from "@higma/fig/color";
import { getPaintColor, getPaintOpacity } from "./paint-domain";
import {
  paintRowStyle,
  paintHeaderStyle,
  paintInlineStyle,
  swatchStyle,
  hexStyle,
  removeButtonStyle,
  addButtonStyle,
} from "./paint-section-styles";

export type PaintItemEditorProps = {
  readonly paint: FigPaint;
  readonly index: number;
  readonly labelPrefix: string;
  readonly imageOptions: readonly { readonly value: string; readonly label: string }[];
  readonly onUpdatePaint: (index: number, updater: (paint: FigPaint) => FigPaint) => void;
  readonly onUpdateType: (index: number, type: FigPaint["type"]) => void;
  readonly onUpdateOpacity: (index: number, opacity: number) => void;
  readonly onUpdateColor: (index: number, hex: string) => void;
  readonly onUpdateImageRef: (index: number, imageRef: string) => void;
  readonly onUpdateImageScaleMode: (index: number, scaleMode: FigImageScaleMode) => void;
  readonly onUpdateImageScale: (index: number, scale: number) => void;
  readonly onUpdateImageRotation: (index: number, rotationDeg: number) => void;
  readonly onStartImageUpload: (index: number) => void;
  readonly onRemove: (index: number) => void;
};

export function PaintItemEditor({
  paint,
  index,
  labelPrefix,
  imageOptions,
  onUpdatePaint,
  onUpdateType,
  onUpdateOpacity,
  onUpdateColor,
  onUpdateImageRef,
  onUpdateImageScaleMode,
  onUpdateImageScale,
  onUpdateImageRotation,
  onStartImageUpload,
  onRemove,
}: PaintItemEditorProps) {
  const color = getPaintColor(paint);
  const opacity = getPaintOpacity(paint);
  const ordinal = index + 1;

  return (
    <div style={paintRowStyle}>
      <div style={paintHeaderStyle}>
        <Select
          value={paint.type}
          onChange={(type) => onUpdateType(index, type)}
          options={paintTypeOptions}
          ariaLabel={`${labelPrefix} paint type ${ordinal}`}
        />
        <Input
          type="number"
          ariaLabel={`${labelPrefix} opacity ${ordinal}`}
          value={Math.round(opacity * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => onUpdateOpacity(index, (v as number) / 100)}
          width={52}
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
      {color && (
        <div style={paintInlineStyle}>
          <input
            aria-label={`${labelPrefix} color ${ordinal}`}
            type="color"
            value={figColorToHex(color)}
            onChange={(e) => onUpdateColor(index, e.target.value)}
            style={swatchStyle}
          />
          <span style={hexStyle}>{figColorToHex(color).toUpperCase()}</span>
        </div>
      )}
      {paint.type.startsWith("GRADIENT_") && (
        <GradientPaintControls
          labelPrefix={labelPrefix}
          paintIndex={index}
          paint={paint}
          onChange={(nextPaint) => onUpdatePaint(index, () => nextPaint)}
        />
      )}
      {paint.type === "IMAGE" && (
        <>
          <div style={paintInlineStyle}>
            <Select
              value={paint.imageRef ?? ""}
              onChange={(value) => onUpdateImageRef(index, value)}
              options={imageOptions}
              ariaLabel={`${labelPrefix} image ${ordinal}`}
            />
            <button type="button" style={addButtonStyle} onClick={() => onStartImageUpload(index)}>
              Upload image
            </button>
          </div>
          <div style={paintInlineStyle}>
            <Select
              value={paint.scaleMode ?? paint.imageScaleMode ?? "FILL"}
              onChange={(value) => onUpdateImageScaleMode(index, value)}
              options={imageScaleModeOptions}
              ariaLabel={`${labelPrefix} image scale mode ${ordinal}`}
            />
            <Input
              type="number"
              ariaLabel={`${labelPrefix} image scale ${ordinal}`}
              value={paint.scalingFactor ?? paint.scale ?? 1}
              min={0}
              step={0.05}
              onChange={(v) => onUpdateImageScale(index, v as number)}
              width={64}
            />
            <Input
              type="number"
              ariaLabel={`${labelPrefix} image rotation ${ordinal}`}
              value={Math.round(((paint.rotation ?? 0) * 180) / Math.PI)}
              step={1}
              onChange={(v) => onUpdateImageRotation(index, v as number)}
              width={64}
              suffix="°"
            />
          </div>
        </>
      )}
    </div>
  );
}
