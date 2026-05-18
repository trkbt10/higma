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
 *
 * Styling
 * -------
 * Pseudo-class rules (`:hover`, `:focus-visible`, `:disabled`) and the
 * `data-full-width` variant rule live in `AddItemButton.module.css`.
 * The CSS Module import returns a JS-used class name map; no runtime
 * style injection, no side-effect imports, no className branching.
 */

import { type MouseEvent } from "react";
import { AddIcon } from "../icons";
import styles from "./AddItemButton.module.css";

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

/** Unified "+" add affordance for list-like surfaces. */
export function AddItemButton({ label, onClick, disabled, ariaLabel, fullWidth = true }: AddItemButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={styles.button}
      data-full-width={fullWidth ? "true" : undefined}
    >
      <AddIcon size={ICON_SIZE} />
      <span>{label}</span>
    </button>
  );
}
