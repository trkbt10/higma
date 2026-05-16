/** @file Node export settings editor adapter. */

import { useCallback } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigExportSetting, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  ExportSettingsSectionView,
  EXPORT_FORMAT_OPTIONS,
  type ExportFormatId,
  type ExportPresetView,
} from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { createPropertyTargetUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type ExportSettingsSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

function toPreset(setting: FigExportSetting): ExportPresetView {
  return {
    format: resolveExportFormat(setting),
    suffix: setting.suffix ?? "",
    scale: resolveExportScale(setting),
  };
}

function resolveExportFormat(setting: FigExportSetting): ExportFormatId {
  const name = setting.imageType?.name;
  if (name === "JPG" || name === "SVG" || name === "PDF") {
    return name;
  }
  return "PNG";
}

function resolveExportScale(setting: FigExportSetting): number {
  const value = setting.constraint?.value;
  return typeof value === "number" && value > 0 ? value : 1;
}

function makeExportImageType(format: ExportFormatId): KiwiEnumValue {
  return { name: format, value: EXPORT_FORMAT_OPTIONS.findIndex((option) => option.value === format) };
}

function makeScaleConstraint(value: number): FigExportSetting["constraint"] {
  return { type: { name: "SCALE", value: 0 }, value };
}

function createDefaultExportSetting(): FigExportSetting {
  return {
    suffix: "",
    imageType: makeExportImageType("PNG"),
    constraint: makeScaleConstraint(1),
  };
}

/** Edit Figma export presets on the selected node. */
export function ExportSettingsSection({ node, target, dispatch }: ExportSettingsSectionProps) {
  const settings = node.exportSettings ?? [];
  const presets = settings.map(toPreset);

  const updateSettings = useCallback(
    (updater: (settings: readonly FigExportSetting[]) => readonly FigExportSetting[]) => {
      dispatch(createPropertyTargetUpdateAction({
        target,
        updater: (n) => ({ ...n, exportSettings: updater(n.exportSettings ?? []) }),
      }));
    },
    [dispatch, target],
  );

  const updateSetting = useCallback(
    (index: number, updater: (setting: FigExportSetting) => FigExportSetting) => {
      updateSettings((current) => current.map((setting, i) => i === index ? updater(setting) : setting));
    },
    [updateSettings],
  );

  return (
    <ExportSettingsSectionView
      presets={presets}
      onFormatChange={(index, format) => updateSetting(index, (current) => ({ ...current, imageType: makeExportImageType(format) }))}
      onSuffixChange={(index, suffix) => updateSetting(index, (current) => ({ ...current, suffix }))}
      onScaleChange={(index, scale) => updateSetting(index, (current) => ({ ...current, constraint: makeScaleConstraint(scale) }))}
      onAddPreset={() => updateSettings((current) => [...current, createDefaultExportSetting()])}
      onRemovePreset={(index) => updateSettings((current) => current.filter((_, i) => i !== index))}
    />
  );
}
