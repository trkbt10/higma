/**
 * @file InlineRenameInput primitive
 *
 * Display-as-text by default, switches to an Input on double-click (or via
 * the `requestRename` imperative handle). Commits on Enter / blur and
 * cancels on Escape, returning to display mode.
 *
 * Single shared primitive for every "double-click a name to rename it"
 * affordance: layer rows, page rows, the property-panel node header, etc.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export type InlineRenameInputHandle = {
  /** Programmatically enter edit mode (e.g. from a context-menu "Rename"). */
  readonly requestRename: () => void;
};

export type InlineRenameInputProps = {
  readonly value: string;
  readonly onCommit: (next: string) => void;
  /** Optional renderer for the display state. Defaults to the raw value. */
  readonly renderDisplay?: (value: string) => ReactNode;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly displayStyle?: CSSProperties;
  /** Whether double-click on the display switches to edit mode. Default true. */
  readonly allowDoubleClickToEdit?: boolean;
};

// `cursor: inherit` — the display state is just a label sitting on
// whatever surface the consumer renders it on. Setting `cursor: text`
// here would tell the operator "this is editable text" on every host,
// but most consumers (Pages row, Layers row, property header) are
// also drag / click targets where the host cursor (`pointer` /
// `grab`) is the correct affordance. Edit mode shows its own `<input>`
// with the normal text caret cursor — the operator gets the right
// signal at the right time without this primitive forcing one.
const displayBaseStyle: CSSProperties = {
  display: "inline-block",
  width: "100%",
  cursor: "inherit",
  userSelect: "none",
};

const disabledStyle: CSSProperties = {
  cursor: "default",
  opacity: 0.6,
};

/**
 * Edit-mode input style.
 *
 * The previous implementation rendered the kernel `Input` primitive
 * (with its own padding, border-radius, and `bg.tertiary` background)
 * which made the row visibly resize and shift when transitioning
 * display → edit. The operator critique was "ダブルクリックで編集
 * モードに入るとレイアウトシフトまで起きる".
 *
 * The fix is to render a bare `<input>` that occupies the same
 * footprint as the display span — same width (100%), `font: inherit`
 * so it adopts the row's font-size / family / weight, transparent
 * background, no border, no padding, no outline. Visually the row
 * appearance doesn't change at all on transition; the only
 * difference is the blinking caret + native text selection.
 *
 * The row's existing selection / focus background already signals
 * "you're in this row" — a separate input chrome would just stack a
 * second box on top of that signal.
 */
const editInputStyle: CSSProperties = {
  display: "inline-block",
  width: "100%",
  boxSizing: "border-box",
  font: "inherit",
  color: "inherit",
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  outline: "none",
};

/**
 * Display-as-text-until-double-click rename input.
 */
export const InlineRenameInput = forwardRef<InlineRenameInputHandle, InlineRenameInputProps>(
  function InlineRenameInput(
    {
      value,
      onCommit,
      renderDisplay,
      ariaLabel,
      disabled,
      placeholder,
      displayStyle,
      allowDoubleClickToEdit = true,
    },
    ref,
  ) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const focusedOnceRef = useRef(false);

    useEffect(() => {
      if (!editing) {
        setDraft(value);
      }
    }, [value, editing]);

    const enterEdit = useCallback(() => {
      if (disabled) {
        return;
      }
      focusedOnceRef.current = false;
      setDraft(value);
      setEditing(true);
    }, [disabled, value]);

    useImperativeHandle(ref, () => ({ requestRename: enterEdit }), [enterEdit]);

    const commit = useCallback(() => {
      const next = draft.trim();
      if (next.length > 0 && next !== value) {
        onCommit(next);
      }
      setEditing(false);
    }, [draft, onCommit, value]);

    const cancel = useCallback(() => {
      setDraft(value);
      setEditing(false);
    }, [value]);

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      },
      [commit, cancel],
    );

    if (editing) {
      return (
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          onFocus={(event) => {
            if (focusedOnceRef.current) {
              return;
            }
            focusedOnceRef.current = true;
            event.currentTarget.select();
          }}
          aria-label={ariaLabel ?? `Rename ${value}`}
          placeholder={placeholder}
          style={editInputStyle}
          autoFocus
        />
      );
    }

    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={ariaLabel ?? `Rename ${value}`}
        style={{ ...displayBaseStyle, ...(disabled ? disabledStyle : {}), ...displayStyle }}
        onDoubleClick={allowDoubleClickToEdit ? enterEdit : undefined}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }
          if (event.key === "F2" || event.key === "Enter") {
            event.preventDefault();
            enterEdit();
          }
        }}
      >
        {renderDisplay ? renderDisplay(value) : value}
      </span>
    );
  },
);
