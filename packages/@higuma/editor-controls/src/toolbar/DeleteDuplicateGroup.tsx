/**
 * @file DeleteDuplicateGroup - Delete/Duplicate toolbar buttons
 */

import { ToolbarButton, TOOLBAR_BUTTON_ICON_SIZE } from "@higuma/ui-components/primitives/ToolbarButton";
import { TrashIcon, CopyIcon } from "@higuma/ui-components/icons";
import { iconTokens } from "@higuma/ui-components/design-tokens";
import type { DeleteDuplicateGroupProps } from "./types";

const iconSize = TOOLBAR_BUTTON_ICON_SIZE.sm.icon;
const strokeWidth = iconTokens.strokeWidth;






/** Delete and duplicate action button group */
export function DeleteDuplicateGroup({ onDelete, onDuplicate, disabled }: DeleteDuplicateGroupProps) {
  const isDisabled = disabled ?? false;
  return (
    <>
      <ToolbarButton
        icon={<TrashIcon size={iconSize} strokeWidth={strokeWidth} />}
        label="Delete (Del)"
        onClick={onDelete}
        disabled={isDisabled}
        size="sm"
      />
      {onDuplicate && (
        <ToolbarButton
          icon={<CopyIcon size={iconSize} strokeWidth={strokeWidth} />}
          label="Duplicate (Ctrl+D)"
          onClick={onDuplicate}
          disabled={isDisabled}
          size="sm"
        />
      )}
    </>
  );
}
