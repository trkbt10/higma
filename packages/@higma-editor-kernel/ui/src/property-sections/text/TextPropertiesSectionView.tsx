/**
 * @file Text properties view (presentational only)
 *
 * Provides the structural layout for the editable text content, the
 * fig-specific vertical alignment row, the line-height row and the auto-resize
 * row. The font formatting block and horizontal alignment block are not
 * rendered here because those live in upper layers (react-editor-ui /
 * editor-surfaces) and depend on the document editor; consumers pass them as
 * `formattingSlot` / `justifySlot` children.
 */

import type { CSSProperties, ReactNode } from "react";
import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";
import { colorTokens } from "../../design-tokens";
import {
  AlignTopIcon,
  AlignMiddleIcon,
  AlignBottomIcon,
} from "../../icons";

export type VerticalAlignId = "TOP" | "CENTER" | "BOTTOM";
export type AutoResizeId = "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE";

export type TextPropertiesSectionViewProps = {
  readonly characters: string;
  readonly onCharactersChange: (value: string) => void;
  /** Slot for the run-formatting editor (font, size, bold, etc.). */
  readonly formattingSlot: ReactNode;
  /** Slot for the horizontal-alignment editor. */
  readonly justifySlot: ReactNode;
  /** Line height in multiples of fontSize (e.g. 1.2). When undefined, the line row is hidden. */
  readonly lineHeightMultiplier: number | undefined;
  readonly onLineHeightMultiplierChange: (value: number) => void;
  readonly verticalAlign: VerticalAlignId;
  readonly onVerticalAlignChange: (value: VerticalAlignId) => void;
  readonly autoResize: AutoResizeId;
  readonly onAutoResizeChange: (value: AutoResizeId) => void;
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "3lh",
  resize: "vertical",
  fontFamily: "inherit",
  fontSize: "var(--font-size-md, 13px)",
  border: `1px solid ${colorTokens.border.strong}`,
  borderRadius: 4,
  padding: 6,
  boxSizing: "border-box",
};

const alignButtonGroupStyle: CSSProperties = {
  display: "flex",
  gap: 2,
};

const alignButtonStyle = (active: boolean): CSSProperties => ({
  background: active ? colorTokens.accent.primary : "transparent",
  color: active ? "#fff" : colorTokens.text.secondary,
  border: `1px solid ${active ? colorTokens.accent.primary : colorTokens.border.primary}`,
  borderRadius: 4,
  padding: "3px 5px",
  cursor: "pointer",
  lineHeight: 0,
});

/** Renders the text-node content/line-height/vertical-align/auto-resize rows with formatting/justify slots. */
export function TextPropertiesSectionView({
  characters,
  onCharactersChange,
  formattingSlot,
  justifySlot,
  lineHeightMultiplier,
  onLineHeightMultiplierChange,
  verticalAlign,
  onVerticalAlignChange,
  autoResize,
  onAutoResizeChange,
}: TextPropertiesSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={characters}
        onChange={(e) => onCharactersChange(e.target.value)}
        style={textareaStyle}
        rows={3}
      />

      {formattingSlot}
      {justifySlot}

      {lineHeightMultiplier !== undefined && (
        <FieldRow>
          <Input
            type="number"
            value={lineHeightMultiplier}
            min={0.5}
            max={10}
            step={0.1}
            prefix="Line"
            suffix="x"
            dragToChange
            dragStep={0.1}
            ariaLabel="Line height multiplier"
            onChange={(v) => {
              const num = typeof v === "number" ? v : parseFloat(String(v));
              if (!isNaN(num) && num > 0) {
                onLineHeightMultiplierChange(num);
              }
            }}
          />
        </FieldRow>
      )}

      <FieldRow>
        <FieldGroup label="V Align" inline labelWidth={48}>
          <div style={alignButtonGroupStyle}>
            <button
              type="button"
              style={alignButtonStyle(verticalAlign === "TOP")}
              onClick={() => onVerticalAlignChange("TOP")}
              title="Top"
            >
              <AlignTopIcon size={14} />
            </button>
            <button
              type="button"
              style={alignButtonStyle(verticalAlign === "CENTER")}
              onClick={() => onVerticalAlignChange("CENTER")}
              title="Center"
            >
              <AlignMiddleIcon size={14} />
            </button>
            <button
              type="button"
              style={alignButtonStyle(verticalAlign === "BOTTOM")}
              onClick={() => onVerticalAlignChange("BOTTOM")}
              title="Bottom"
            >
              <AlignBottomIcon size={14} />
            </button>
          </div>
        </FieldGroup>
      </FieldRow>

      <FieldRow>
        <FieldGroup label="Resize" inline labelWidth={48}>
          <div style={alignButtonGroupStyle}>
            <button
              type="button"
              style={alignButtonStyle(autoResize === "WIDTH_AND_HEIGHT")}
              onClick={() => onAutoResizeChange("WIDTH_AND_HEIGHT")}
              title="Auto width & height"
            >
              W+H
            </button>
            <button
              type="button"
              style={alignButtonStyle(autoResize === "HEIGHT")}
              onClick={() => onAutoResizeChange("HEIGHT")}
              title="Fixed width, auto height"
            >
              H
            </button>
            <button
              type="button"
              style={alignButtonStyle(autoResize === "NONE")}
              onClick={() => onAutoResizeChange("NONE")}
              title="Fixed size (clips overflow)"
            >
              Fix
            </button>
          </div>
        </FieldGroup>
      </FieldRow>
    </div>
  );
}
