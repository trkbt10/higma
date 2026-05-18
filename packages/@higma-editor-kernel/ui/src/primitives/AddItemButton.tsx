/**
 * @file AddItemButton primitive
 *
 * Single, consistent affordance for "add a new item to this list" actions
 * across the editor (add page, add fill, add stroke, add effect, add export
 * preset, add vector path, …).
 *
 * Visual: full-width dashed-border ghost button with leading `+` icon and a
 * compact label. Replaces the ad-hoc "+ Add X" buttons that previously each
 * carried their own inline styles.
 */

import type { CSSProperties, MouseEvent } from "react";
import { colorTokens, fontTokens } from "../design-tokens";
import { AddIcon } from "../icons";

export type AddItemButtonProps = {
  /** Action verb phrase shown after the `+` icon, e.g. "Add fill". */
  readonly label: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  /** Override the full-width default for tight layouts. */
  readonly fullWidth?: boolean;
};

const ICON_SIZE = 12;

function buttonStyle(disabled: boolean, fullWidth: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    background: "none",
    border: `1px dashed ${colorTokens.border.primary}`,
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    padding: "4px 8px",
    color: colorTokens.text.primary,
    fontSize: fontTokens.size.sm,
    width: fullWidth ? "100%" : undefined,
    opacity: disabled ? 0.5 : 1,
  };
}

/** Unified "+" add affordance for list-like surfaces. */
export function AddItemButton({ label, onClick, disabled, ariaLabel, fullWidth = true }: AddItemButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      style={buttonStyle(Boolean(disabled), fullWidth)}
    >
      <AddIcon size={ICON_SIZE} />
      <span>{label}</span>
    </button>
  );
}
