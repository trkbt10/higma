/**
 * @file WrapTextButton - Text wrap toggle button
 */

import { ToolbarButton, TOOLBAR_BUTTON_ICON_SIZE } from "@higma-editor-kernel/ui/primitives/ToolbarButton";
import { WrapTextIcon } from "@higma-editor-kernel/ui/icons";
import { iconTokens } from "@higma-editor-kernel/ui/design-tokens";
import type { WrapTextButtonProps } from "./types";

const iconSize = TOOLBAR_BUTTON_ICON_SIZE.sm.icon;
const strokeWidth = iconTokens.strokeWidth;






/** Toggle button for text wrapping */
export function WrapTextButton({ pressed, onChange, disabled }: WrapTextButtonProps) {
  return (
    <ToolbarButton
      label="Wrap text"
      icon={<WrapTextIcon size={iconSize} strokeWidth={strokeWidth} />}
      active={pressed}
      disabled={disabled ?? false}
      size="sm"
      onClick={() => {
        onChange(pressed !== true);
      }}
    />
  );
}
