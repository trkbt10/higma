/**
 * @file Input primitive component
 *
 * A minimal input component with optional prefix and suffix slots rendered
 * inside the input chrome.
 *
 * - **prefix**: role / axis label (e.g. "X", "Y", "W", "TL", "G"). Strings
 *   render as static tertiary-text; ReactNode renders unchanged.
 * - **suffix**: unit tag (e.g. "px", "%", "°", "x"). Strings render as static
 *   tertiary-text; ReactNode renders unchanged (e.g. a SuffixSelect for
 *   switchable modes).
 *
 * Number inputs may opt into Figma-style click-drag editing by setting
 * `dragToChange`. The prefix label becomes a horizontal scrubber: hovering it
 * shows the `ew-resize` cursor, pointer-down + horizontal drag mutates the
 * value by `dragStep` (default = step) per pixel. Shift multiplies by 10.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { colorTokens, fontTokens, radiusTokens } from "../design-tokens";

export type InputProps = {
  readonly value: string | number;
  readonly onChange: (value: string | number) => void;
  /** DOM ChangeEvent callback — use when you need selectionStart/End from the event. */
  readonly onInputChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly type?: "text" | "number";
  /**
   * Leading slot rendered inside the input chrome. Reserved for role / axis
   * labels (X, Y, W, H, G, …). Strings render as static tertiary-text; a
   * ReactNode renders unchanged.
   */
  readonly prefix?: ReactNode;
  /**
   * Trailing slot rendered inside the input chrome. Reserved for unit tags
   * (px, %, °, x, …). Strings render as static tertiary-text; a ReactNode
   * renders unchanged (e.g. a SuffixSelect dropdown).
   */
  readonly suffix?: ReactNode;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  readonly onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  /** Fires when the text selection (caret position) changes — arrow keys, mouse clicks, etc. */
  readonly onSelect?: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  readonly onCompositionStart?: (event: React.CompositionEvent<HTMLInputElement>) => void;
  readonly onCompositionUpdate?: (event: React.CompositionEvent<HTMLInputElement>) => void;
  readonly onCompositionEnd?: (event: React.CompositionEvent<HTMLInputElement>) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Width constraint for the input container */
  readonly width?: number | string;
  /**
   * Enable Figma-style horizontal drag on the prefix label to change the
   * number value. Requires `type === "number"` and a text prefix. The cursor
   * becomes `ew-resize` on the prefix and pointer-capture keeps the drag
   * alive when the pointer leaves the prefix bounds.
   */
  readonly dragToChange?: boolean;
  /** Value delta per pixel of horizontal drag. Defaults to `step ?? 1`. */
  readonly dragStep?: number;
};

// One-time style injection for spinner hiding
const stylesInjected = { current: false };
function injectStyles() {
  if (stylesInjected.current || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-input::-webkit-outer-spin-button,
    .office-editor-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .office-editor-input {
      -moz-appearance: textfield;
    }
  `;
  document.head.appendChild(style);
  stylesInjected.current = true;
}

/**
 * Chrome / digit-area split.
 *
 * Numeric prefix+suffix chrome occupies roughly:
 *   prefix(6+1+2) + input-pad(2) + digits + input-pad(2) + suffix(2+~2chars+6)
 * For an 80 px cell this leaves ~50 px of digit area — enough for 3-digit
 * percentage values and a small caret margin. Cells narrower than ~60 px
 * cannot fit both a prefix and a suffix and must drop the prefix at the
 * call site (the surrounding section's responsibility).
 *
 * When the call site sets `width`, the container is also marked
 * `flexShrink: 0` so a parent flex row does not silently squeeze the
 * input below the requested width and clip the digits — a flex row that
 * cannot fit all its inputs should wrap instead of forcing each to
 * become unusable.
 */

const containerStyle = (width?: number | string): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  backgroundColor: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
  borderRadius: radiusTokens.sm,
  overflow: "hidden",
  width: width ?? "100%",
  minWidth: width ?? "48px",
  maxWidth: width ?? "100%",
  flexShrink: width === undefined ? 1 : 0,
});

const inputInnerStyle = (
  hasPrefix: boolean,
  hasSuffix: boolean,
  numeric: boolean,
): CSSProperties => ({
  flex: 1,
  // The digit area must remain shrinkable so that prefix/suffix chrome
  // never overflows the container; numeric values that overflow scroll
  // horizontally inside the input rather than blowing out the cell.
  minWidth: 0,
  width: "100%",
  padding: `4px ${hasSuffix ? "2px" : "6px"} 4px ${hasPrefix ? "2px" : "6px"}`,
  fontSize: fontTokens.size.md,
  fontFamily: "inherit",
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  backgroundColor: "transparent",
  border: "none",
  outline: "none",
  // Right-align numeric values so the most-significant digits stay
  // visible when the cell narrows. Free-text inputs keep the default so
  // the caret behaves naturally mid-edit.
  textAlign: numeric ? "right" : undefined,
});

const slotTextBaseStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.medium,
  color: `var(--text-tertiary, ${colorTokens.text.tertiary})`,
  userSelect: "none",
  pointerEvents: "none",
};

const prefixTextStyle: CSSProperties = {
  ...slotTextBaseStyle,
  paddingLeft: "6px",
  paddingRight: "2px",
};

const suffixTextStyle: CSSProperties = {
  ...slotTextBaseStyle,
  paddingLeft: "2px",
  paddingRight: "6px",
};

const prefixDragStyle: CSSProperties = {
  flexShrink: 0,
  paddingLeft: "6px",
  paddingRight: "2px",
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.medium,
  color: `var(--text-tertiary, ${colorTokens.text.tertiary})`,
  userSelect: "none",
  cursor: "ew-resize",
  touchAction: "none",
};

const slotNodeBaseStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
};

const prefixSlotStyle: CSSProperties = {
  ...slotNodeBaseStyle,
  paddingLeft: "2px",
  paddingRight: "2px",
};

const suffixSlotStyle: CSSProperties = {
  ...slotNodeBaseStyle,
  paddingLeft: "2px",
  paddingRight: "2px",
};

function parseNumeric(value: string | number): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function quantize(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }
  if (step >= 1) {
    return Math.round(value / step) * step;
  }
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function clampValue(value: number, min: number | undefined, max: number | undefined): number {
  const lower = typeof min === "number" ? Math.max(min, value) : value;
  return typeof max === "number" ? Math.min(max, lower) : lower;
}

/**
 * Input field with optional prefix (role label) and suffix (unit) slots, plus
 * optional Figma-style click-drag editing on the prefix.
 */
export function Input({
  value,
  onChange,
  onInputChange,
  type = "text",
  prefix,
  suffix,
  placeholder,
  ariaLabel,
  disabled,
  readOnly,
  onKeyDown,
  onFocus,
  onBlur,
  onSelect,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  className,
  style,
  min,
  max,
  step,
  width,
  dragToChange,
  dragStep,
}: InputProps) {
  // Inject spinner-hiding styles once
  useEffect(() => {
    injectStyles();
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onInputChange?.(e);
      const newValue = type === "number" ? parseFloat(e.target.value) : e.target.value;
      onChange(type === "number" && isNaN(newValue as number) ? 0 : newValue);
    },
    [onChange, onInputChange, type]
  );

  const hasPrefix = prefix !== undefined && prefix !== null && prefix !== false;
  const prefixIsText = typeof prefix === "string" || typeof prefix === "number";
  const hasSuffix = suffix !== undefined && suffix !== null && suffix !== false;
  const suffixIsText = typeof suffix === "string" || typeof suffix === "number";

  const dragEnabled =
    dragToChange === true && type === "number" && prefixIsText && !disabled && !readOnly;

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
  } | null>(null);

  const handlePrefixPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (!dragEnabled) {
        return;
      }
      const startValue = parseNumeric(value);
      if (startValue === undefined) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startValue,
      };
    },
    [dragEnabled, value],
  );

  const handlePrefixPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }
      const baseStep = dragStep ?? step ?? 1;
      const multiplier = event.shiftKey ? 10 : 1;
      const effective = baseStep * multiplier;
      const rawNext = state.startValue + (event.clientX - state.startX) * effective;
      const next = clampValue(quantize(rawNext, effective), min, max);
      const current = parseNumeric(value);
      if (current !== next) {
        onChange(next);
      }
    },
    [dragStep, step, min, max, onChange, value],
  );

  const handlePrefixPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragStateRef.current = null;
    },
    [],
  );

  return (
    <div
      style={{ ...containerStyle(width), ...style }}
      className={className}
    >
      {hasPrefix && prefixIsText && (
        <span
          style={dragEnabled ? prefixDragStyle : prefixTextStyle}
          aria-hidden="true"
          onPointerDown={dragEnabled ? handlePrefixPointerDown : undefined}
          onPointerMove={dragEnabled ? handlePrefixPointerMove : undefined}
          onPointerUp={dragEnabled ? handlePrefixPointerEnd : undefined}
          onPointerCancel={dragEnabled ? handlePrefixPointerEnd : undefined}
        >
          {prefix}
        </span>
      )}
      {hasPrefix && !prefixIsText && <span style={prefixSlotStyle}>{prefix}</span>}
      <input
        type={type}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onSelect={onSelect}
        onCompositionStart={onCompositionStart}
        onCompositionUpdate={onCompositionUpdate}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        style={inputInnerStyle(hasPrefix, hasSuffix, type === "number")}
        className="office-editor-input"
      />
      {hasSuffix && suffixIsText && <span style={suffixTextStyle}>{suffix}</span>}
      {hasSuffix && !suffixIsText && <span style={suffixSlotStyle}>{suffix}</span>}
    </div>
  );
}
