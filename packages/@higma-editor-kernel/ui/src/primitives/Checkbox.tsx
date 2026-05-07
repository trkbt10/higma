/**
 * @file Checkbox primitive — square checkbox with check / indeterminate states.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { CheckIcon } from "../icons";
import { colorTokens, radiusTokens } from "../design-tokens";

export type CheckboxProps = {
  /** Toggle state. `"mixed"` renders the indeterminate variant for select-all rows. */
  readonly checked: boolean | "mixed";
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
};

const SIZE = 16;

const containerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: SIZE,
  height: SIZE,
  flexShrink: 0,
  position: "relative",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  opacity: 0,
  cursor: "inherit",
};

function pickBoxBorder(checked: boolean | "mixed"): string {
  const accent = `var(--accent-primary, ${colorTokens.accent.primary})`;
  if (checked === false) {
    return `1px solid var(--border-strong, ${colorTokens.border.strong})`;
  }
  return `1px solid ${accent}`;
}

function pickBoxBackground(checked: boolean | "mixed"): string {
  if (checked === false) {
    return `var(--bg-primary, ${colorTokens.background.primary})`;
  }
  return `var(--accent-primary, ${colorTokens.accent.primary})`;
}

function boxStyle(checked: boolean | "mixed", disabled: boolean): CSSProperties {
  return {
    width: SIZE,
    height: SIZE,
    borderRadius: radiusTokens.xs,
    border: pickBoxBorder(checked),
    background: pickBoxBackground(checked),
    color: colorTokens.text.inverse,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.1s ease, border-color 0.1s ease",
    opacity: disabled ? 0.5 : 1,
  };
}

const indeterminateBarStyle: CSSProperties = {
  display: "block",
  width: 8,
  height: 2,
  background: colorTokens.text.inverse,
  borderRadius: 1,
};

/** Square checkbox primitive matching the kernel UI design tokens. */
export function Checkbox({
  checked,
  onChange,
  disabled,
  ariaLabel,
  className,
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
    <span style={{ ...containerStyle, ...style, cursor: disabled ? "not-allowed" : "pointer" }} className={className}>
      <span style={boxStyle(checked, disabled ?? false)} aria-hidden="true">
        {checked === "mixed" && <span style={indeterminateBarStyle} />}
        {checked === true && <CheckIcon size={12} strokeWidth={2.5} />}
      </span>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked === true}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
        style={inputStyle}
      />
    </span>
  );
}
