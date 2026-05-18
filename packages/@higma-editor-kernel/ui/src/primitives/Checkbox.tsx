/**
 * @file Checkbox primitive — square checkbox with check / indeterminate states.
 *
 * Styling
 * -------
 * Checked / mixed / disabled variants are expressed via `data-checked`
 * and `data-disabled` attributes; pseudo-class rules and the
 * projected focus ring (`:has(input:focus-visible)`) live in
 * `Checkbox.module.css`. No imperative style injection, no className
 * branching.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { CheckIcon } from "../icons";
import styles from "./Checkbox.module.css";

export type CheckboxProps = {
  /** Toggle state. `"mixed"` renders the indeterminate variant for select-all rows. */
  readonly checked: boolean | "mixed";
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly style?: CSSProperties;
};

function checkedAttr(checked: boolean | "mixed"): "true" | "false" | "mixed" {
  if (checked === "mixed") {
    return "mixed";
  }
  return checked ? "true" : "false";
}

/** Square checkbox primitive matching the kernel UI design tokens. */
export function Checkbox({
  checked,
  onChange,
  disabled,
  ariaLabel,
  style,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = checked === "mixed";
    }
  }, [checked]);

  const handleChange = useCallback(() => {
    if (disabled) {
      return;
    }
    if (checked === "mixed") {
      onChange(true);
      return;
    }
    onChange(!checked);
  }, [checked, disabled, onChange]);

  return (
    <span
      style={style}
      className={styles.container}
      data-disabled={disabled ? "true" : undefined}
    >
      <span
        className={styles.box}
        data-checked={checkedAttr(checked)}
        aria-hidden="true"
      >
        {checked === "mixed" && <span className={styles.indeterminateBar} />}
        {checked === true && <CheckIcon size={12} strokeWidth={2.5} />}
      </span>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked === true}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className={styles.input}
      />
    </span>
  );
}
