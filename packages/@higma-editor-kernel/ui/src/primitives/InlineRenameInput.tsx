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
import { Input } from "./Input";

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

const displayBaseStyle: CSSProperties = {
  display: "inline-block",
  width: "100%",
  cursor: "text",
  userSelect: "none",
};

const disabledStyle: CSSProperties = {
  cursor: "default",
  opacity: 0.6,
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
        <Input
          value={draft}
          onChange={(v) => setDraft(String(v))}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          onFocus={(event) => {
            if (focusedOnceRef.current) {
              return;
            }
            focusedOnceRef.current = true;
            event.currentTarget.select();
          }}
          ariaLabel={ariaLabel ?? `Rename ${value}`}
          placeholder={placeholder}
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
