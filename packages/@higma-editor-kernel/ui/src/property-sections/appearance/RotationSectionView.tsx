/**
 * @file Rotation section view (presentational only)
 *
 * Rotation angle input plus the rotate / flip-H / flip-V quick-action row
 * from Figma's Position panel. Each transform-action handler is optional;
 * the corresponding button only renders when its handler is provided.
 */

import type { CSSProperties } from "react";
import { Input } from "../../primitives";
import { FieldRow } from "../../layout";
import { TransformActions } from "../../operations";

export type RotationSectionViewProps = {
  /** Rotation in degrees. */
  readonly rotation: number;
  readonly onRotationChange: (value: number) => void;
  /** Handler for "rotate 90° CW". When omitted, the button is hidden. */
  readonly onRotateCW?: () => void;
  /** Handler for "flip horizontal". When omitted, the button is hidden. */
  readonly onFlipHorizontal?: () => void;
  /** Handler for "flip vertical". When omitted, the button is hidden. */
  readonly onFlipVertical?: () => void;
  readonly disabled?: boolean;
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const inputWrapperStyle: CSSProperties = {
  flex: 1,
};

/** Renders the Rotation row from Figma's Position panel. */
export function RotationSectionView({
  rotation,
  onRotationChange,
  onRotateCW,
  onFlipHorizontal,
  onFlipVertical,
  disabled,
}: RotationSectionViewProps) {
  return (
    <FieldRow>
      <div style={rowStyle}>
        <div style={inputWrapperStyle}>
          <Input
            type="number"
            ariaLabel="Rotation"
            value={rotation}
            suffix="°"
            dragToChange
            disabled={disabled}
            onChange={(value) => onRotationChange(value as number)}
          />
        </div>
        <TransformActions
          onRotateCW={onRotateCW}
          onFlipHorizontal={onFlipHorizontal}
          onFlipVertical={onFlipVertical}
          disabled={disabled}
        />
      </div>
    </FieldRow>
  );
}
