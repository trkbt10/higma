/**
 * @file Select primitive component
 *
 * A minimal select/dropdown component.
 */

import { useCallback, useRef, type ChangeEvent, type CSSProperties } from "react";
import type { SelectOption } from "../types";
import { colorTokens, fontTokens, radiusTokens } from "../design-tokens";

/**
 * Select shares the same hover / focus contract as the other input
 * primitives so the editor reads as a single coherent surface.
 *
 * The dropdown caret is rendered as a CSS background image. The
 * previous SVG fill colour (`#737373`) gave only ~4:1 contrast against
 * the input background and was hard to spot. The caret colour now
 * follows `text.primary` so the "this is a dropdown" affordance is
 * unambiguous.
 */
const styleFlag = { injected: false };
function injectStyles(): void {
  if (styleFlag.injected || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-select:focus-visible {
      outline: 2px solid var(--selection-primary, #0066ff);
      outline-offset: 2px;
    }
    .office-editor-select:not(:disabled):hover {
      background-color: var(--bg-hover, #e8eaed);
    }
  `;
  document.head.appendChild(style);
  styleFlag.injected = true;
}

// Encoded dark-grey caret used for the dropdown affordance. The hex
// is URL-encoded inline so the SVG stays valid as a data URI.
const CARET_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%231a1a1a' d='M2.5 4.5L6 8l3.5-3.5'/%3E%3C/svg%3E\")";

export type SelectProps<T extends string = string> = {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
};

const selectStyle: CSSProperties = {
  padding: "5px 8px",
  fontSize: fontTokens.size.md,
  fontFamily: "inherit",
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  backgroundColor: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
  border: "none",
  borderRadius: radiusTokens.sm,
  outline: "none",
  cursor: "pointer",
  appearance: "none",
  backgroundImage: CARET_DATA_URI,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 6px center",
  paddingRight: "24px",
  width: "100%",
  transition: "background-color 150ms ease",
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
  className,
  style,
}: SelectProps<T>) {
  const initialized = useRef(false);
  if (!initialized.current) {
    injectStyles();
    initialized.current = true;
  }

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value as T);
    },
    [onChange]
  );

  const composedClassName = ["office-editor-select", className].filter(Boolean).join(" ");

  return (
    <select
      value={value}
      onChange={handleChange}
      aria-label={ariaLabel}
      disabled={disabled}
      className={composedClassName}
      style={{ ...selectStyle, ...style }}
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
