/**
 * @file UndoRedoGroup - Undo/Redo toolbar button pair
 */

import { ToolbarButton, TOOLBAR_BUTTON_ICON_SIZE } from "@higma-editor-kernel/ui/primitives/ToolbarButton";
import { UndoIcon, RedoIcon } from "@higma-editor-kernel/ui/icons";
import { iconTokens } from "@higma-editor-kernel/ui/design-tokens";
import type { UndoRedoGroupProps } from "./types";

const iconSize = TOOLBAR_BUTTON_ICON_SIZE.sm.icon;
const strokeWidth = iconTokens.strokeWidth;






/** Undo/redo action button group */
export function UndoRedoGroup({ canUndo, canRedo, onUndo, onRedo, disabled }: UndoRedoGroupProps) {
  return (
    <>
      <ToolbarButton
        icon={<UndoIcon size={iconSize} strokeWidth={strokeWidth} />}
        label="Undo (Ctrl+Z)"
        onClick={onUndo}
        disabled={disabled || !canUndo}
        size="sm"
      />
      <ToolbarButton
        icon={<RedoIcon size={iconSize} strokeWidth={strokeWidth} />}
        label="Redo (Ctrl+Y)"
        onClick={onRedo}
        disabled={disabled || !canRedo}
        size="sm"
      />
    </>
  );
}
