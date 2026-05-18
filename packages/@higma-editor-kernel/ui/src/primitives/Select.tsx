/**
 * @file Select primitive component
 *
 * A minimal select/dropdown component.
 *
 * Styling
 * -------
 * Caret + hover + focus rules live in `Select.module.css`. No
 * imperative style injection, no className branching.
 */

import { useCallback, type ChangeEvent, type CSSProperties } from "react";
import type { SelectOption } from "../types";
import styles from "./Select.module.css";

export type SelectProps<T extends string = string> = {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
};

/**
 * Select dropdown for predefined options.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  style,
}: SelectProps<T>) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value as T);
    },
    [onChange]
  );

  return (
    <select
      value={value}
      onChange={handleChange}
      aria-label={ariaLabel}
      disabled={disabled}
      className={styles.select}
      style={style}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
