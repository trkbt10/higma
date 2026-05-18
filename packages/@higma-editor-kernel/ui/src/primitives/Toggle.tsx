/**
 * @file Toggle primitive component
 *
 * A minimal toggle/switch component.
 */

import { useCallback, useRef, type CSSProperties } from "react";
import { colorTokens, fontTokens } from "../design-tokens";

export type ToggleProps = {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
};

/**
 * The Toggle used to be a non-focusable `<div role="switch">` — keyboard
 * users could not toggle it. It is now a real `<button>` with
 * `role="switch"`, which gets focus + Space + Enter for free from the
 * browser. The container preserves the layout (label sits next to the
 * track) by being a flex row inside the button.
 *
 * Styling notes:
 * - `outline: none` is intentional; we render our own focus ring
 *   (selection.primary, 2px) so it is visible against both white and
 *   bg.tertiary panel backgrounds at >=4:1 contrast (WCAG 2.4.7 needs
 *   >=3:1 for focus indicators).
 * - `:focus-visible` is preferred over `:focus` so mouse clicks do not
 *   light up the ring; only keyboard focus does.
 */
const containerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  fontFamily: "inherit",
  borderRadius: "10px",
  outline: "none",
};

// One-time injection of :focus-visible + :hover rules. Inline styles
// cannot express pseudo-class selectors, so the toggle ships its own
// stylesheet block once per page lifetime.
const styleFlag = { injected: false };
function injectStyles(): void {
  if (styleFlag.injected || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-toggle:focus-visible {
      outline: 2px solid var(--selection-primary, #0066ff);
      outline-offset: 2px;
    }
    .office-editor-toggle:hover:not(:disabled) .office-editor-toggle__track {
      box-shadow: 0 0 0 2px var(--bg-hover, #e8eaed);
    }
    .office-editor-toggle:disabled {
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
  styleFlag.injected = true;
}

function getTrackBackgroundColor(checked: boolean): string {
  if (checked) {
    return `var(--accent-secondary, ${colorTokens.accent.secondary})`;
  }
  return `var(--bg-tertiary, ${colorTokens.background.tertiary})`;
}

const trackStyle = (checked: boolean, disabled: boolean): CSSProperties => ({
  position: "relative",
  width: "28px",
  height: "16px",
  borderRadius: "8px",
  backgroundColor: getTrackBackgroundColor(checked),
  transition: "background-color 150ms ease",
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? "not-allowed" : "pointer",
  flexShrink: 0,
});

const thumbStyle = (checked: boolean): CSSProperties => ({
  position: "absolute",
  top: "2px",
  left: checked ? "14px" : "2px",
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  backgroundColor: "#ffffff",
  transition: "left 150ms ease",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
});

const labelStyle: CSSProperties = {
  fontSize: fontTokens.size.md,
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  userSelect: "none",
};

/**
 * Toggle switch input.
 *
 * Implemented as a real `<button role="switch">` so the browser
 * supplies keyboard focus + Space/Enter activation natively. The
 * previous `<div role="switch">` was a screen-reader-only control —
 * keyboard users had no way to toggle it.
 */
export function Toggle({ checked, onChange, label, ariaLabel, disabled, className, style }: ToggleProps) {
  const initialized = useRef(false);
  if (!initialized.current) {
    injectStyles();
    initialized.current = true;
  }
  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!checked);
    }
  }, [checked, onChange, disabled]);

  return (
    <button
      type="button"
      style={{ ...containerStyle, ...style }}
      className={["office-editor-toggle", className].filter(Boolean).join(" ")}
      onClick={handleClick}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
    >
      <span style={trackStyle(checked, disabled ?? false)} className="office-editor-toggle__track">
        <span style={thumbStyle(checked)} />
      </span>
      {label && <span style={labelStyle}>{label}</span>}
    </button>
  );
}
