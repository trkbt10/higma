/**
 * @file Export settings view (presentational only)
 *
 * Renders a list of export presets (format + suffix + scale) with add/remove
 * controls. Format values are kernel-defined; callers map between this kernel
 * enum and their domain (e.g. FigExportSetting.imageType KiwiEnum).
 */

import type { CSSProperties } from "react";
import { Input, Select } from "../../primitives";
import type { SelectOption } from "../../types";
import { colorTokens } from "../../design-tokens";
import { CloseIcon } from "../../icons";
import { AddItemButton } from "../../primitives";

export type ExportFormatId = "PNG" | "JPG" | "SVG" | "PDF";

export type ExportPresetView = {
  readonly format: ExportFormatId;
  readonly suffix: string;
  readonly scale: number;
};

export type ExportSettingsSectionViewProps = {
  readonly presets: readonly ExportPresetView[];
  readonly onFormatChange: (index: number, format: ExportFormatId) => void;
  readonly onSuffixChange: (index: number, suffix: string) => void;
  readonly onScaleChange: (index: number, scale: number) => void;
  readonly onAddPreset: () => void;
  readonly onRemovePreset: (index: number) => void;
};

export const EXPORT_FORMAT_OPTIONS: readonly SelectOption<ExportFormatId>[] = [
  { value: "PNG", label: "PNG" },
  { value: "JPG", label: "JPG" },
  { value: "SVG", label: "SVG" },
  { value: "PDF", label: "PDF" },
];

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 0",
  // Subtle separator between presets — without it adjacent presets
  // visually blur together and the operator has to count to know
  // which row belongs to which preset.
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const lastRowStyle: CSSProperties = {
  ...rowStyle,
  borderBottom: "none",
};

const removeButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 2,
  color: colorTokens.text.primary,
  lineHeight: 0,
  flexShrink: 0,
};

/** Renders export presets (format + suffix + scale) with add/remove controls. */
export function ExportSettingsSectionView({
  presets,
  onFormatChange,
  onSuffixChange,
  onScaleChange,
  onAddPreset,
  onRemovePreset,
}: ExportSettingsSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {presets.map((preset, index) => (
        <div key={index} style={index === presets.length - 1 ? lastRowStyle : rowStyle}>
          <Select
            value={preset.format}
            onChange={(value) => onFormatChange(index, value)}
            options={EXPORT_FORMAT_OPTIONS}
            ariaLabel={`Export format ${index + 1}`}
          />
          <Input
            type="text"
            ariaLabel={`Export suffix ${index + 1}`}
            value={preset.suffix}
            placeholder="@2x"
            onChange={(value) => onSuffixChange(index, String(value))}
            width={70}
          />
          <Input
            type="number"
            ariaLabel={`Export scale ${index + 1}`}
            value={preset.scale}
            min={0.01}
            step={0.25}
            suffix="x"
            dragToChange
            dragStep={0.25}
            onChange={(value) => onScaleChange(index, value as number)}
            width={88}
          />
          <button
            type="button"
            style={removeButtonStyle}
            onClick={() => onRemovePreset(index)}
            title="Remove export setting"
            aria-label={`Remove export preset ${index + 1}`}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <AddItemButton label="Add export preset" onClick={onAddPreset} />
    </div>
  );
}
