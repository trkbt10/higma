/**
 * @file ConstraintAnchorGrid — single-operation primitive
 *
 * 3x3 visual anchor selector mirroring Figma's Constraints widget. The 9
 * grid cells encode the 2D combination of horizontal × vertical anchor
 * (MIN/CENTER/MAX). Clicking a cell selects both anchors at once; the four
 * mid-edge handles (top/right/bottom/left dashes) toggle the corresponding
 * axis between its current anchor and STRETCH.
 *
 * Anchor values are kernel-defined string ids ("MIN"|"CENTER"|"MAX"|
 * "STRETCH"|"SCALE") matching the LayoutConstraintsSection enums; consumers
 * map these to their domain (e.g. fig Kiwi enums) in an adapter.
 */

import type { CSSProperties } from "react";
import { colorTokens } from "../design-tokens";

export type ConstraintAxisAnchor = "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
export type ConstraintAnchorCell = "MIN" | "CENTER" | "MAX";

export type ConstraintAnchorGridProps = {
  readonly horizontal: ConstraintAxisAnchor;
  readonly vertical: ConstraintAxisAnchor;
  readonly onChange: (next: {
    readonly horizontal: ConstraintAxisAnchor;
    readonly vertical: ConstraintAxisAnchor;
  }) => void;
};

type CellPosition = {
  readonly horizontal: ConstraintAnchorCell;
  readonly vertical: ConstraintAnchorCell;
};

const CELLS: readonly CellPosition[] = [
  { horizontal: "MIN", vertical: "MIN" },
  { horizontal: "CENTER", vertical: "MIN" },
  { horizontal: "MAX", vertical: "MIN" },
  { horizontal: "MIN", vertical: "CENTER" },
  { horizontal: "CENTER", vertical: "CENTER" },
  { horizontal: "MAX", vertical: "CENTER" },
  { horizontal: "MIN", vertical: "MAX" },
  { horizontal: "CENTER", vertical: "MAX" },
  { horizontal: "MAX", vertical: "MAX" },
];

const GRID_SIZE = 88;
const CELL_PADDING = 6;
const NODE_SIZE = 28;
const NODE_INDICATOR_SIZE = 6;
const STRETCH_HANDLE_LEN = 14;

const wrapperStyle: CSSProperties = {
  position: "relative",
  width: GRID_SIZE,
  height: GRID_SIZE,
  borderRadius: 6,
  border: `1px solid var(--border-subtle, ${colorTokens.border.subtle})`,
  background: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
  flexShrink: 0,
};

const cellGridStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gridTemplateRows: "repeat(3, 1fr)",
};

const cellStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 0,
};

const stretchHandleBaseStyle: CSSProperties = {
  position: "absolute",
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Stretch-bar colour signals the constraint state.
 *
 * - Active: `accent.primary` (#4472C4, 4.45:1 vs white) — passes
 *   WCAG 1.4.11 non-text 3:1 minimum so the active rail is clearly
 *   visible.
 * - Inactive: `text.secondary` (#5f6368, 6.05:1 vs white) — also
 *   passes 3:1 so the inactive guides are still discoverable. The
 *   previous design used `text.tertiary` at opacity 0.55 which gave
 *   ~1.57:1 — effectively invisible against a white panel.
 */
function stretchBarColor(active: boolean): string {
  if (active) {
    return `var(--accent-primary, ${colorTokens.accent.primary})`;
  }
  return `var(--text-secondary, ${colorTokens.text.secondary})`;
}

const stretchBarStyle = (active: boolean): CSSProperties => ({
  background: stretchBarColor(active),
  borderRadius: 1,
});

function cellToValue(cell: ConstraintAnchorCell): ConstraintAxisAnchor {
  return cell;
}

function isAnchorAtCell(anchor: ConstraintAxisAnchor, cell: ConstraintAnchorCell): boolean {
  if (anchor === cell) {
    return true;
  }
  // STRETCH / SCALE don't map to a cell selection; the cell representation
  // falls back to CENTER for visualisation purposes.
  if ((anchor === "STRETCH" || anchor === "SCALE") && cell === "CENTER") {
    return true;
  }
  return false;
}

function nodeIndicatorPosition(anchor: ConstraintAxisAnchor): "start" | "center" | "end" {
  if (anchor === "MIN") {
    return "start";
  }
  if (anchor === "MAX") {
    return "end";
  }
  return "center";
}

function nodePositionStyle(
  horizontal: ConstraintAxisAnchor,
  vertical: ConstraintAxisAnchor,
): CSSProperties {
  const horizontalPlacement = nodeIndicatorPosition(horizontal);
  const verticalPlacement = nodeIndicatorPosition(vertical);
  const horizontalStretch = horizontal === "STRETCH" || horizontal === "SCALE";
  const verticalStretch = vertical === "STRETCH" || vertical === "SCALE";

  const width = horizontalStretch ? GRID_SIZE - CELL_PADDING * 2 : NODE_SIZE;
  const height = verticalStretch ? GRID_SIZE - CELL_PADDING * 2 : NODE_SIZE;

  const horizontalOffset = (() => {
    if (horizontalStretch) {
      return CELL_PADDING;
    }
    if (horizontalPlacement === "start") {
      return CELL_PADDING;
    }
    if (horizontalPlacement === "end") {
      return GRID_SIZE - CELL_PADDING - NODE_SIZE;
    }
    return (GRID_SIZE - NODE_SIZE) / 2;
  })();

  const verticalOffset = (() => {
    if (verticalStretch) {
      return CELL_PADDING;
    }
    if (verticalPlacement === "start") {
      return CELL_PADDING;
    }
    if (verticalPlacement === "end") {
      return GRID_SIZE - CELL_PADDING - NODE_SIZE;
    }
    return (GRID_SIZE - NODE_SIZE) / 2;
  })();

  return {
    position: "absolute",
    left: horizontalOffset,
    top: verticalOffset,
    width,
    height,
    border: `1px solid var(--text-tertiary, ${colorTokens.text.tertiary})`,
    borderRadius: 3,
    background: "transparent",
    pointerEvents: "none",
  };
}

function dotStyle(
  horizontal: ConstraintAxisAnchor,
  vertical: ConstraintAxisAnchor,
): CSSProperties | undefined {
  const horizontalStretch = horizontal === "STRETCH" || horizontal === "SCALE";
  const verticalStretch = vertical === "STRETCH" || vertical === "SCALE";
  if (horizontalStretch || verticalStretch) {
    return undefined;
  }
  return {
    position: "absolute",
    width: NODE_INDICATOR_SIZE,
    height: NODE_INDICATOR_SIZE,
    borderRadius: "50%",
    background: `var(--accent-primary, ${colorTokens.accent.primary})`,
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  };
}

/** Renders Figma's 3x3 constraint-anchor widget. */
export function ConstraintAnchorGrid({ horizontal, vertical, onChange }: ConstraintAnchorGridProps) {
  const toggleHorizontalStretch = () => {
    onChange({
      horizontal: horizontal === "STRETCH" ? "CENTER" : "STRETCH",
      vertical,
    });
  };
  const toggleVerticalStretch = () => {
    onChange({
      horizontal,
      vertical: vertical === "STRETCH" ? "CENTER" : "STRETCH",
    });
  };

  return (
    <div style={wrapperStyle} role="group" aria-label="Constraint anchor">
      <div style={cellGridStyle}>
        {CELLS.map((cell) => {
          const isSelected =
            isAnchorAtCell(horizontal, cell.horizontal) &&
            isAnchorAtCell(vertical, cell.vertical);
          return (
            <button
              key={`${cell.horizontal}-${cell.vertical}`}
              type="button"
              style={cellStyle}
              aria-label={`Anchor ${cell.horizontal.toLowerCase()} ${cell.vertical.toLowerCase()}`}
              aria-pressed={isSelected}
              onClick={() =>
                onChange({
                  horizontal: cellToValue(cell.horizontal),
                  vertical: cellToValue(cell.vertical),
                })
              }
            />
          );
        })}
      </div>
      <div style={nodePositionStyle(horizontal, vertical)} aria-hidden="true" />
      {dotStyle(horizontal, vertical) && <div style={dotStyle(horizontal, vertical)} aria-hidden="true" />}
      <button
        type="button"
        aria-label="Toggle horizontal stretch constraint"
        aria-pressed={horizontal === "STRETCH"}
        title="Toggle horizontal stretch constraint"
        onClick={toggleHorizontalStretch}
        style={{
          ...stretchHandleBaseStyle,
          left: 0,
          right: 0,
          top: -8,
          height: 16,
        }}
      >
        <div style={{ ...stretchBarStyle(horizontal === "STRETCH"), width: STRETCH_HANDLE_LEN, height: 2 }} />
      </button>
      <button
        type="button"
        aria-label="Toggle horizontal stretch constraint (bottom)"
        aria-pressed={horizontal === "STRETCH"}
        title="Toggle horizontal stretch constraint"
        onClick={toggleHorizontalStretch}
        style={{
          ...stretchHandleBaseStyle,
          left: 0,
          right: 0,
          bottom: -8,
          height: 16,
        }}
      >
        <div style={{ ...stretchBarStyle(horizontal === "STRETCH"), width: STRETCH_HANDLE_LEN, height: 2 }} />
      </button>
      <button
        type="button"
        aria-label="Toggle vertical stretch constraint"
        aria-pressed={vertical === "STRETCH"}
        title="Toggle vertical stretch constraint"
        onClick={toggleVerticalStretch}
        style={{
          ...stretchHandleBaseStyle,
          top: 0,
          bottom: 0,
          left: -8,
          width: 16,
        }}
      >
        <div style={{ ...stretchBarStyle(vertical === "STRETCH"), height: STRETCH_HANDLE_LEN, width: 2 }} />
      </button>
      <button
        type="button"
        aria-label="Toggle vertical stretch constraint (right)"
        aria-pressed={vertical === "STRETCH"}
        title="Toggle vertical stretch constraint"
        onClick={toggleVerticalStretch}
        style={{
          ...stretchHandleBaseStyle,
          top: 0,
          bottom: 0,
          right: -8,
          width: 16,
        }}
      >
        <div style={{ ...stretchBarStyle(vertical === "STRETCH"), height: STRETCH_HANDLE_LEN, width: 2 }} />
      </button>
    </div>
  );
}
