/** @file Vector path editing view (presentational only). */

import { type CSSProperties } from "react";
import { Input, Select } from "../../primitives";
import type { SelectOption } from "../../types";
import { AddIcon, CloseIcon } from "../../icons";
import { colorTokens, fontTokens } from "../../design-tokens";

export type WindingRuleId = "NONZERO" | "EVENODD";

export type PathEditableCommandType = "M" | "L" | "Q" | "C" | "Z";

export type PathEditableCommand = {
  readonly type: PathEditableCommandType;
  readonly values: readonly number[];
};

export type VectorPathItemView = {
  readonly winding: WindingRuleId;
  /** Raw path string `M 0 0 L 100 0 Z` — caller is responsible for serialization. */
  readonly raw: string;
  /** Parsed structured commands, or undefined when the raw cannot be parsed. */
  readonly commands: readonly PathEditableCommand[] | undefined;
};

export type VectorPathSectionViewProps = {
  readonly paths: readonly VectorPathItemView[];
  readonly onAddPath: () => void;
  readonly onRemovePath: (index: number) => void;
  readonly onWindingChange: (index: number, winding: WindingRuleId) => void;
  readonly onRawChange: (index: number, raw: string) => void;
  readonly onCommandTypeChange: (index: number, commandIndex: number, type: PathEditableCommandType) => void;
  readonly onCommandValueChange: (index: number, commandIndex: number, valueIndex: number, value: number) => void;
  readonly onAddPoint: (index: number) => void;
  readonly onAddCubic: (index: number) => void;
};

export const WINDING_OPTIONS: readonly SelectOption<WindingRuleId>[] = [
  { value: "NONZERO", label: "Non-zero" },
  { value: "EVENODD", label: "Even-odd" },
];

export const PATH_COMMAND_OPTIONS: readonly SelectOption<PathEditableCommandType>[] = [
  { value: "M", label: "Move" },
  { value: "L", label: "Line" },
  { value: "Q", label: "Quad" },
  { value: "C", label: "Cubic" },
  { value: "Z", label: "Close" },
];

export const PATH_COMMAND_PARAM_LABELS: Record<PathEditableCommandType, readonly string[]> = {
  M: ["X", "Y"],
  L: ["X", "Y"],
  Q: ["X1", "Y1", "X", "Y"],
  C: ["X1", "Y1", "X2", "Y2", "X", "Y"],
  Z: [],
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "4px 0",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 64,
  resize: "vertical",
  fontFamily: "monospace",
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.primary,
  backgroundColor: colorTokens.background.tertiary,
  border: `1px solid ${colorTokens.border.primary}`,
  borderRadius: 4,
  padding: 6,
  boxSizing: "border-box",
};

const buttonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  border: `1px dashed ${colorTokens.border.primary}`,
  background: "none",
  borderRadius: 4,
  padding: "4px 8px",
  color: colorTokens.text.secondary,
  cursor: "pointer",
  fontSize: fontTokens.size.sm,
};

const commandRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "64px 1fr",
  gap: 6,
  alignItems: "start",
};

const commandFieldsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 4,
};

const removeButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: colorTokens.text.tertiary,
  cursor: "pointer",
  lineHeight: 0,
  padding: 2,
};

/** Renders vector paths with raw string + structured command editors. */
export function VectorPathSectionView({
  paths,
  onAddPath,
  onRemovePath,
  onWindingChange,
  onRawChange,
  onCommandTypeChange,
  onCommandValueChange,
  onAddPoint,
  onAddCubic,
}: VectorPathSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {paths.map((path, index) => (
        <div key={index} style={rowStyle}>
          <div style={headerStyle}>
            <Select
              value={path.winding}
              onChange={(value) => onWindingChange(index, value)}
              options={WINDING_OPTIONS}
              ariaLabel={`Path ${index + 1} winding rule`}
            />
            <button type="button" title="Remove path" style={removeButtonStyle} onClick={() => onRemovePath(index)}>
              <CloseIcon size={12} />
            </button>
          </div>
          <textarea
            aria-label={`Path ${index + 1} data`}
            value={path.raw}
            onChange={(e) => onRawChange(index, e.currentTarget.value)}
            style={textareaStyle}
          />
          {path.commands && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {path.commands.map((command, commandIndex) => (
                <div key={commandIndex} style={commandRowStyle}>
                  <Select
                    value={command.type}
                    onChange={(nextType) => onCommandTypeChange(index, commandIndex, nextType)}
                    options={PATH_COMMAND_OPTIONS}
                    ariaLabel={`Path ${index + 1} command ${commandIndex + 1} type`}
                  />
                  <div style={commandFieldsStyle}>
                    {PATH_COMMAND_PARAM_LABELS[command.type].map((label, valueIndex) => (
                      <Input
                        key={`${commandIndex}-${label}`}
                        type="number"
                        ariaLabel={`Path ${index + 1} command ${commandIndex + 1} ${label}`}
                        value={command.values[valueIndex] ?? 0}
                        suffix={label}
                        onChange={(value) => onCommandValueChange(index, commandIndex, valueIndex, value as number)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={buttonStyle} onClick={() => onAddPoint(index)}>
                  Add point
                </button>
                <button type="button" style={buttonStyle} onClick={() => onAddCubic(index)}>
                  Add cubic
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button type="button" style={buttonStyle} onClick={onAddPath}>
        <AddIcon size={12} />
        Add path
      </button>
    </div>
  );
}
