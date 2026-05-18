/**
 * @file Checkbox primitive — square checkbox with check / indeterminate states.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { CheckIcon } from "../icons";
import { colorTokens, radiusTokens } from "../design-tokens";

/**
 * The Checkbox uses the invisible-overlay pattern (a native checkbox
 * input sits on top of the visual surface at opacity:0). The native
 * input correctly receives keyboard focus, but the browser's default
 * focus ring renders against an invisible element, so it's not visible
 * to the user. We project the focus ring onto the sibling visual box
 * using `:has(input:focus-visible)` on the container.
 *
 * Hover state likewise needs CSS pseudo-classes — inline `style` can't
 * express them — so the primitive ships its own stylesheet.
 */
const styleFlag = { injected: false };
function injectStyles(): void {
  if (styleFlag.injected || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-checkbox:has(input:focus-visible) .office-editor-checkbox__box {
      outline: 2px solid var(--selection-primary, #0066ff);
      outline-offset: 2px;
    }
    .office-editor-checkbox:not(:has(input:disabled)):hover .office-editor-checkbox__box {
      box-shadow: 0 0 0 2px var(--bg-hover, #e8eaed);
    }
  `;
  document.head.appendChild(style);
  styleFlag.injected = true;
}

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
  const initialized = useRef(false);
  if (!initialized.current) {
    injectStyles();
    initialized.current = true;
  }

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

  const composedClassName = ["office-editor-checkbox", className].filter(Boolean).join(" ");

  return (
    <span
      style={{ ...containerStyle, ...style, cursor: disabled ? "not-allowed" : "pointer" }}
      className={composedClassName}
    >
      <span
        style={boxStyle(checked, disabled ?? false)}
        className="office-editor-checkbox__box"
        aria-hidden="true"
      >
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
