/**
 * @file Workspace mode toggle: switches the site editor between canvas and CMS view.
 */

import { useCallback } from "react";
import { GridIcon, TableIcon } from "@higma-editor-kernel/ui/icons";
import { ToggleButton } from "@higma-editor-kernel/ui/primitives/ToggleButton";
import { iconTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

export type SiteEditorWorkspaceMode = "canvas" | "cms";

export type SiteEditorWorkspaceModeToggleProps = {
  readonly value: SiteEditorWorkspaceMode;
  readonly onChange: (mode: SiteEditorWorkspaceMode) => void;
};

const ICON_SIZE = iconTokens.size.sm;
const ICON_STROKE = iconTokens.strokeWidth;

/** Toggle between the canvas-centric and CMS-centric workspace surfaces. */
export function SiteEditorWorkspaceModeToggle({ value, onChange }: SiteEditorWorkspaceModeToggleProps) {
  const handleSelectCanvas = useCallback(
    (pressed: boolean) => {
      if (pressed) {
        onChange("canvas");
      }
    },
    [onChange],
  );
  const handleSelectCms = useCallback(
    (pressed: boolean) => {
      if (pressed) {
        onChange("cms");
      }
    },
    [onChange],
  );

  return (
    <div role="tablist" aria-label="Site editor workspace" style={{ display: "flex", gap: spacingTokens.xs }}>
      <ToggleButton
        ariaLabel="Canvas workspace"
        label="Canvas"
        pressed={value === "canvas"}
        onChange={handleSelectCanvas}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: spacingTokens.xs }}>
          <GridIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          Canvas
        </span>
      </ToggleButton>
      <ToggleButton
        ariaLabel="CMS workspace"
        label="CMS"
        pressed={value === "cms"}
        onChange={handleSelectCms}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: spacingTokens.xs }}>
          <TableIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          CMS
        </span>
      </ToggleButton>
    </div>
  );
}
