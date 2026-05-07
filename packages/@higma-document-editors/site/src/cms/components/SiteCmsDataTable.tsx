/**
 * @file Generic CMS data table reused by Collection list / fields / items / selectors views.
 */

import type { CSSProperties, ReactNode } from "react";
import { colorTokens, fontTokens, radiusTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

export type SiteCmsTableColumn<Row> = {
  readonly id: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  readonly width?: string;
  readonly align?: "start" | "end";
};

export type SiteCmsTableProps<Row> = {
  readonly caption: string;
  readonly columns: readonly SiteCmsTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly onRowClick?: (row: Row) => void;
  readonly isRowSelected?: (row: Row) => boolean;
  readonly emptyLabel?: string;
};

const tableShellStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: fontTokens.size.md,
  color: colorTokens.text.primary,
};

const captionStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const headerCellStyle: CSSProperties = {
  textAlign: "left",
  textTransform: "uppercase",
  letterSpacing: fontTokens.letterSpacing.uppercase,
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.xs,
  fontWeight: fontTokens.weight.semibold,
  padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  background: colorTokens.background.secondary,
};

function bodyCellStyle(align: SiteCmsTableColumn<unknown>["align"]): CSSProperties {
  return {
    padding: `${spacingTokens.sm} ${spacingTokens.sm}`,
    borderBottom: `1px solid ${colorTokens.border.subtle}`,
    verticalAlign: "top",
    color: colorTokens.text.primary,
    textAlign: align === "end" ? "right" : "left",
    minWidth: 0,
  };
}

function rowStyle(active: boolean, clickable: boolean): CSSProperties {
  if (active) {
    return {
      cursor: clickable ? "pointer" : "default",
      background: colorTokens.background.tertiary,
    };
  }
  return {
    cursor: clickable ? "pointer" : "default",
    background: "transparent",
  };
}

const emptyRowStyle: CSSProperties = {
  padding: `${spacingTokens.md} ${spacingTokens.md}`,
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.sm,
  textAlign: "center",
};

const containerStyle: CSSProperties = {
  width: "100%",
  border: `1px solid ${colorTokens.border.subtle}`,
  borderRadius: radiusTokens.md,
  overflow: "hidden",
  background: colorTokens.background.primary,
};

/** Render a structured table view used across CMS pages. */
export function SiteCmsDataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  isRowSelected,
  emptyLabel = "No entries",
}: SiteCmsTableProps<Row>) {
  const clickable = onRowClick !== undefined;
  return (
    <div style={containerStyle} role="region" aria-label={caption}>
      <table style={tableShellStyle}>
        <caption style={captionStyle}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={{
                  ...headerCellStyle,
                  width: column.width,
                  textAlign: column.align === "end" ? "right" : "left",
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={emptyRowStyle}>{emptyLabel}</td>
            </tr>
          )}
          {rows.map((row) => {
            const active = isRowSelected ? isRowSelected(row) : false;
            return (
              <tr
                key={rowKey(row)}
                style={rowStyle(active, clickable)}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? "button" : undefined}
                aria-label={clickable ? `Open ${rowKey(row)}` : undefined}
              >
                {columns.map((column) => (
                  <td key={column.id} style={bodyCellStyle(column.align)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
