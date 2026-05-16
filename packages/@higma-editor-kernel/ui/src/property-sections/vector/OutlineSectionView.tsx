/**
 * @file Outline conversion view (presentational only)
 *
 * Renders an "Outline selection" button. The caller decides whether the
 * action is supported for the current node and whether the user is allowed
 * to invoke it; this view only renders the button and an optional note.
 */

import type { CSSProperties, ReactNode } from "react";
import { colorTokens, fontTokens } from "../../design-tokens";

export type OutlineSectionViewProps = {
  readonly enabled: boolean;
  readonly onOutline: () => void;
  /** Optional inline note shown beneath the button (e.g. text-node caveat). */
  readonly note?: ReactNode;
};

const buttonStyle: CSSProperties = {
  width: "100%",
  border: `1px solid ${colorTokens.border.primary}`,
  background: colorTokens.background.secondary,
  color: colorTokens.text.primary,
  borderRadius: 4,
  padding: "6px 8px",
  cursor: "pointer",
  fontSize: fontTokens.size.sm,
};

const noteStyle: CSSProperties = {
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.sm,
  lineHeight: 1.4,
};

/** Renders the "Outline selection" action button with an optional note. */
export function OutlineSectionView({ enabled, onOutline, note }: OutlineSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        style={{ ...buttonStyle, opacity: enabled ? 1 : 0.5, cursor: enabled ? "pointer" : "default" }}
        disabled={!enabled}
        onClick={() => {
          if (enabled) {
            onOutline();
          }
        }}
      >
        Outline selection
      </button>
      {note && <div style={noteStyle}>{note}</div>}
    </div>
  );
}
