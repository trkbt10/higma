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
 *
 * Styling
 * -------
 * Drag-scrubber affordance (`data-drag="true"`) and error state
 * (`data-error="true"`) drive the variant rules in
 * `Input.module.css`. No imperative style injection, no className
 * branching.
 */

import {
  useCallback,
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import styles from "./Input.module.css";

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
  /**
   * Visual error state. Renders a `accent.danger` border around the
   * input chrome and sets `aria-invalid="true"` so screen readers
   * announce the field as invalid. Use when validation fails — e.g.
   * Stroke weight = "-5" or Opacity = "200".
   */
  readonly error?: boolean;
  /**
   * Description of the validation failure, rendered as the `title`
   * attribute (tooltip) and used as the screen-reader description via
   * `aria-errormessage` linkage when present.
   */
  readonly errorMessage?: string;
};

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
const containerSizeStyle = (width?: number | string): CSSProperties => {
  const resolved = width ?? "100%";
  return {
    width: resolved,
    minWidth: width ?? "48px",
    maxWidth: resolved,
    flexShrink: width === undefined ? 1 : 0,
  };
};

const innerSlotPaddingStyle = (
  hasPrefix: boolean,
  hasSuffix: boolean,
): CSSProperties => ({
  padding: `4px ${hasSuffix ? "2px" : "6px"} 4px ${hasPrefix ? "2px" : "6px"}`,
});

const slotInlinePadding = {
  leftEdge: { paddingLeft: "6px", paddingRight: "2px" } as CSSProperties,
  rightEdge: { paddingLeft: "2px", paddingRight: "6px" } as CSSProperties,
  inset: { paddingLeft: "2px", paddingRight: "2px" } as CSSProperties,
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
  style,
  min,
  max,
  step,
  width,
  dragToChange,
  dragStep,
  error,
  errorMessage,
}: InputProps) {
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

  // Auto-derive error state from min/max constraint violations so
  // every numeric input shows a validation visual without each
  // section needing to wire it manually. Caller-supplied `error`
  // wins so a section can explicitly mark a valid-by-constraint
  // value as invalid for higher-level reasons (e.g. cross-field).
  const numericValue = type === "number" ? parseNumeric(value) : undefined;
  const violatesMin = typeof min === "number" && numericValue !== undefined && numericValue < min;
  const violatesMax = typeof max === "number" && numericValue !== undefined && numericValue > max;
  const constraintError = violatesMin || violatesMax;
  const effectiveError = error ?? constraintError;
  const effectiveErrorMessage =
    errorMessage ??
    (violatesMin ? `Value must be at least ${min}` : violatesMax ? `Value must be at most ${max}` : undefined);

  // Drag-to-change can attach to either the prefix or the suffix
  // label, whichever is present and is text. When BOTH are text the
  // prefix wins (operator's eye scans left-to-right; the prefix is
  // the canonical drag handle in Figma's inspector). When neither is
  // text the feature is silently disabled — the call site is expected
  // to supply at least one chrome label when it asks for drag.
  const dragOnPrefix =
    dragToChange === true && type === "number" && prefixIsText && !disabled && !readOnly;
  const dragOnSuffix =
    dragToChange === true && type === "number" && !prefixIsText && suffixIsText && !disabled && !readOnly;
  const dragEnabled = dragOnPrefix || dragOnSuffix;

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

  const containerInline: CSSProperties = { ...containerSizeStyle(width), ...style };

  return (
    <div
      style={containerInline}
      className={styles.container}
      data-error={effectiveError ? "true" : undefined}
      title={effectiveError ? effectiveErrorMessage : undefined}
    >
      {hasPrefix && prefixIsText && (
        <span
          className={styles.slotText}
          data-drag={dragOnPrefix ? "true" : undefined}
          style={slotInlinePadding.leftEdge}
          aria-hidden="true"
          title={dragOnPrefix ? "Drag horizontally to change" : undefined}
          onPointerDown={dragOnPrefix ? handlePrefixPointerDown : undefined}
          onPointerMove={dragOnPrefix ? handlePrefixPointerMove : undefined}
          onPointerUp={dragOnPrefix ? handlePrefixPointerEnd : undefined}
          onPointerCancel={dragOnPrefix ? handlePrefixPointerEnd : undefined}
        >
          {prefix}
        </span>
      )}
      {hasPrefix && !prefixIsText && (
        <span className={styles.slotNode} style={slotInlinePadding.inset}>
          {prefix}
        </span>
      )}
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
        aria-invalid={effectiveError || undefined}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        style={innerSlotPaddingStyle(hasPrefix, hasSuffix)}
        className={styles.input}
      />
      {hasSuffix && suffixIsText && (
        <span
          className={styles.slotText}
          data-drag={dragOnSuffix ? "true" : undefined}
          style={slotInlinePadding.rightEdge}
          aria-hidden="true"
          title={dragOnSuffix ? "Drag horizontally to change" : undefined}
          onPointerDown={dragOnSuffix ? handlePrefixPointerDown : undefined}
          onPointerMove={dragOnSuffix ? handlePrefixPointerMove : undefined}
          onPointerUp={dragOnSuffix ? handlePrefixPointerEnd : undefined}
          onPointerCancel={dragOnSuffix ? handlePrefixPointerEnd : undefined}
        >
          {suffix}
        </span>
      )}
      {hasSuffix && !suffixIsText && (
        <span className={styles.slotNode} style={slotInlinePadding.inset}>
          {suffix}
        </span>
      )}
    </div>
  );
}
