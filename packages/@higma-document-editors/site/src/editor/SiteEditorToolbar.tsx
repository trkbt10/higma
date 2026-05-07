/**
 * @file Site editor toolbar.
 */

import { useCallback } from "react";
import { SelectIcon } from "@higma-editor-kernel/ui/icons";
import { ToolbarButton } from "@higma-editor-kernel/ui/primitives/ToolbarButton";
import { ToolbarSeparator } from "@higma-editor-kernel/ui/primitives/ToolbarSeparator";
import { ToggleButton } from "@higma-editor-kernel/ui/primitives/ToggleButton";
import { colorTokens, fontTokens, iconTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

import { useSiteEditor } from "../context/SiteEditorContext";

const ICON_SIZE = iconTokens.size.sm;
const ICON_STROKE = iconTokens.strokeWidth;

function readFirstUnitId(unitIds: readonly string[]): string {
  const firstUnitId = unitIds[0];
  if (!firstUnitId) {
    throw new Error("SiteEditorToolbar requires at least one editable unit");
  }
  return firstUnitId;
}

/** Toolbar for site editor selection and document counters. */
export function SiteEditorToolbar() {
  const {
    workspace,
    editableUnits,
    selectedUnit,
    selectedUnitId,
    activeSurface,
    activeBreakpointId,
    setActiveBreakpointId,
    setSelectedUnitId,
  } = useSiteEditor();
  const unitIds = editableUnits.map((unit) => unit.id);
  const firstUnitId = readFirstUnitId(unitIds);
  const activeUnitIds = new Set(unitIds);
  const activeCmsBindingCount = workspace.cmsBindings.filter((binding) => activeUnitIds.has(binding.unitId)).length;

  const handleSelectRoot = useCallback(() => {
    setSelectedUnitId(firstUnitId);
  }, [firstUnitId, setSelectedUnitId]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacingTokens.xs, width: "100%" }}>
      <ToolbarButton
        icon={<SelectIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
        label="Select first layout unit"
        active={selectedUnitId === firstUnitId}
        onClick={handleSelectRoot}
        size="sm"
      />
      <ToolbarSeparator />
      {workspace.breakpoints.map((breakpoint) => (
        <ToggleButton
          key={breakpoint.id}
          label={breakpoint.name}
          pressed={activeBreakpointId === breakpoint.id}
          disabled={!activeSurface.breakpointNames.includes(breakpoint.name)}
          onChange={(pressed) => {
            if (pressed) {
              setActiveBreakpointId(breakpoint.id);
            }
          }}
          style={{
            fontSize: fontTokens.size.sm,
            height: 24,
          }}
        />
      ))}
      {workspace.breakpoints.length > 0 ? <ToolbarSeparator /> : null}
      <span style={{ color: colorTokens.text.secondary, fontSize: fontTokens.size.sm }}>
        {activeSurface.label} / {selectedUnit.label} / {editableUnits.length} units / {activeCmsBindingCount} CMS
      </span>
    </div>
  );
}
