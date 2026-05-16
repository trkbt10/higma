/**
 * @file SuffixSelect primitive
 *
 * Visually identical to a static suffix label (small tertiary text inside the
 * Input chrome) but acts as a dropdown. Used when the suffix carries a
 * switchable mode tag (e.g. Fixed / Hug / Fill, °/rad, px/%).
 *
 * Implemented with a native <select> overlaid on top of a styled label so we
 * inherit native keyboard / focus / accessibility behaviour while keeping the
 * suffix's visual treatment intact.
 */

import { useCallback, type ChangeEvent, type CSSProperties } from "react";
import type { SelectOption } from "../types";
import { colorTokens, fontTokens } from "../design-tokens";

export type SuffixSelectProps<T extends string = string> = {
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  /** Override the rendered label. Defaults to the option's label or the value. */
  readonly label?: string;
};

const wrapperStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  flexShrink: 0,
  paddingRight: "8px",
};

const labelStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: `var(--text-tertiary, ${colorTokens.text.tertiary})`,
  userSelect: "none",
  cursor: "pointer",
  pointerEvents: "none",
};

const nativeSelectStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  cursor: "pointer",
  appearance: "none",
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
};

/** Suffix slot styled like static suffix text but backed by a native select dropdown. */
export function SuffixSelect<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  label,
}: SuffixSelectProps<T>) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onChange(event.target.value as T);
    },
    [onChange],
  );

  const displayLabel = label ?? options.find((option) => option.value === value)?.label ?? value;

  return (
    <span style={wrapperStyle}>
      <span style={{ ...labelStyle, cursor: disabled ? "not-allowed" : "pointer" }}>
        {displayLabel}
      </span>
      <select
        value={value}
        onChange={handleChange}
        aria-label={ariaLabel}
        disabled={disabled}
        style={nativeSelectStyle}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
