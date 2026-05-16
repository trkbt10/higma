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
import { colorTokens, fontTokens } from "../../design-tokens";
import { AddIcon, CloseIcon } from "../../icons";

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
  padding: "4px 0",
};

const addButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: `1px dashed ${colorTokens.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
  padding: "4px 8px",
  color: colorTokens.text.secondary,
  fontSize: fontTokens.size.sm,
  width: "100%",
  justifyContent: "center",
};

const removeButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 2,
  color: colorTokens.text.tertiary,
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
        <div key={index} style={rowStyle}>
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
            onChange={(value) => onScaleChange(index, value as number)}
            width={64}
            suffix="x"
          />
          <button
            type="button"
            style={removeButtonStyle}
            onClick={() => onRemovePreset(index)}
            title="Remove export setting"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button type="button" style={addButtonStyle} onClick={onAddPreset}>
        <AddIcon size={12} />
        Add export preset
      </button>
    </div>
  );
}
