/** @file Stroke section view (presentational only). */

import { type Ref, type ChangeEvent } from "react";
import { AddIcon } from "../../icons";
import { Input, Select } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";
import type { SelectOption } from "../../types";
import { colorTokens, fontTokens } from "../../design-tokens";
import { PaintItemEditorView, type PaintItemImageOption } from "./PaintItemEditorView";
import {
  sectionContainerStyle,
  addButtonStyle,
  IMAGE_ACCEPT_TYPES,
} from "./paint-section-styles";
import type { PaintItemView } from "./paint-view-model";
import type { PaintItemHandlers } from "./FillSectionView";

export type StrokeAlignId = "CENTER" | "INSIDE" | "OUTSIDE";
export type StrokeCapId = "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL";
export type StrokeJoinId = "MITER" | "BEVEL" | "ROUND";

export const STROKE_ALIGN_OPTIONS: readonly SelectOption<StrokeAlignId>[] = [
  { value: "CENTER", label: "Center" },
  { value: "INSIDE", label: "Inside" },
  { value: "OUTSIDE", label: "Outside" },
];

export const STROKE_CAP_OPTIONS: readonly SelectOption<StrokeCapId>[] = [
  { value: "NONE", label: "None" },
  { value: "ROUND", label: "Round" },
  { value: "SQUARE", label: "Square" },
  { value: "ARROW_LINES", label: "Line arrow" },
  { value: "ARROW_EQUILATERAL", label: "Triangle arrow" },
];

export const STROKE_JOIN_OPTIONS: readonly SelectOption<StrokeJoinId>[] = [
  { value: "MITER", label: "Miter" },
  { value: "BEVEL", label: "Bevel" },
  { value: "ROUND", label: "Round" },
];

export type StrokeSectionViewProps = {
  readonly strokes: readonly PaintItemView[];
  readonly strokeWeight: number;
  readonly align: StrokeAlignId;
  readonly cap: StrokeCapId;
  readonly join: StrokeJoinId;
  readonly dashes: readonly number[];
  readonly imageOptions: readonly PaintItemImageOption[];
  readonly fileInputRef: Ref<HTMLInputElement>;
  readonly onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onStrokeWeightChange: (value: number) => void;
  readonly onAlignChange: (value: StrokeAlignId) => void;
  readonly onCapChange: (value: StrokeCapId) => void;
  readonly onJoinChange: (value: StrokeJoinId) => void;
  readonly onDashesChange: (value: readonly number[]) => void;
  readonly onAddPaint: () => void;
  readonly handlers: PaintItemHandlers;
};

/** Renders stroke paints plus weight/align/cap/join/dash controls. */
export function StrokeSectionView({
  strokes,
  strokeWeight,
  align,
  cap,
  join,
  dashes,
  imageOptions,
  fileInputRef,
  onImageFileChange,
  onStrokeWeightChange,
  onAlignChange,
  onCapChange,
  onJoinChange,
  onDashesChange,
  onAddPaint,
  handlers,
}: StrokeSectionViewProps) {
  const hasContent = strokes.length > 0 || strokeWeight > 0;

  return (
    <div style={sectionContainerStyle}>
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT_TYPES}
        onChange={onImageFileChange}
        style={{ display: "none" }}
      />
      {hasContent && (
        <>
          <FieldRow>
            <FieldGroup label="Weight" inline labelWidth={50}>
              <Input
                type="number"
                ariaLabel="Stroke weight"
                value={strokeWeight}
                min={0}
                step={0.5}
                onChange={(v) => onStrokeWeightChange(v as number)}
                width={60}
              />
            </FieldGroup>
            <span style={{ fontSize: fontTokens.size.xs, color: colorTokens.text.tertiary }}>
              {align}
            </span>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Align" inline labelWidth={42}>
              <Select
                value={align}
                onChange={onAlignChange}
                options={STROKE_ALIGN_OPTIONS}
                ariaLabel="Stroke align"
              />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Cap" inline labelWidth={32}>
              <Select
                value={cap}
                onChange={onCapChange}
                options={STROKE_CAP_OPTIONS}
                ariaLabel="Stroke cap"
              />
            </FieldGroup>
            <FieldGroup label="Join" inline labelWidth={36}>
              <Select
                value={join}
                onChange={onJoinChange}
                options={STROKE_JOIN_OPTIONS}
                ariaLabel="Stroke join"
              />
            </FieldGroup>
          </FieldRow>
          <FieldRow>
            <FieldGroup label="Dash" inline labelWidth={38}>
              <Input
                type="text"
                ariaLabel="Stroke dash pattern"
                value={dashes.join(" ")}
                onChange={(v) => {
                  const parsed = String(v)
                    .split(/[\s,]+/)
                    .filter((part) => part.length > 0)
                    .map((part) => Number(part));
                  if (parsed.some((part) => !Number.isFinite(part) || part < 0)) {
                    return;
                  }
                  onDashesChange(parsed);
                }}
              />
            </FieldGroup>
          </FieldRow>
        </>
      )}

      {strokes.map((stroke, i) => (
        <PaintItemEditorView
          key={i}
          paint={stroke}
          index={i}
          labelPrefix="Stroke"
          imageOptions={imageOptions}
          {...handlers}
        />
      ))}

      <button type="button" style={addButtonStyle} onClick={onAddPaint}>
        <AddIcon size={12} />
        Add stroke
      </button>
    </div>
  );
}
