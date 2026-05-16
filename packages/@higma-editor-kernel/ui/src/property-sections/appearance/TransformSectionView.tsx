/**
 * @file Transform property section view (presentational only)
 *
 * Renders X/Y position, W/H size, rotation, and transform origin inputs.
 * No knowledge of any specific document model — callers compute the values
 * (e.g. from FigDesignNode.transform) and supply a single onChange callback.
 */

import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";

export type TransformSectionField =
  | "x"
  | "y"
  | "w"
  | "h"
  | "rotation"
  | "originX"
  | "originY";

export type TransformSectionViewProps = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Rotation in degrees. */
  readonly rotation: number;
  readonly originX: number;
  readonly originY: number;
  readonly onChange: (field: TransformSectionField, value: number) => void;
};

/** Renders position, size, rotation and transform-origin inputs. */
export function TransformSectionView({
  x,
  y,
  width,
  height,
  rotation,
  originX,
  originY,
  onChange,
}: TransformSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldRow>
        <FieldGroup label="X" inline labelWidth={16}>
          <Input
            type="number"
            ariaLabel="X"
            value={x}
            onChange={(value) => onChange("x", value as number)}
          />
        </FieldGroup>
        <FieldGroup label="Y" inline labelWidth={16}>
          <Input
            type="number"
            ariaLabel="Y"
            value={y}
            onChange={(value) => onChange("y", value as number)}
          />
        </FieldGroup>
      </FieldRow>
      <FieldRow>
        <FieldGroup label="W" inline labelWidth={16}>
          <Input
            type="number"
            ariaLabel="Width"
            value={width}
            onChange={(value) => onChange("w", value as number)}
          />
        </FieldGroup>
        <FieldGroup label="H" inline labelWidth={16}>
          <Input
            type="number"
            ariaLabel="Height"
            value={height}
            onChange={(value) => onChange("h", value as number)}
          />
        </FieldGroup>
      </FieldRow>
      <FieldRow>
        <FieldGroup label="R" inline labelWidth={16}>
          <Input
            type="number"
            ariaLabel="Rotation"
            value={rotation}
            onChange={(value) => onChange("rotation", value as number)}
            suffix="°"
          />
        </FieldGroup>
      </FieldRow>
      <FieldRow>
        <FieldGroup label="OX" inline labelWidth={24}>
          <Input
            type="number"
            ariaLabel="Origin X"
            value={originX}
            onChange={(value) => onChange("originX", value as number)}
          />
        </FieldGroup>
        <FieldGroup label="OY" inline labelWidth={24}>
          <Input
            type="number"
            ariaLabel="Origin Y"
            value={originY}
            onChange={(value) => onChange("originY", value as number)}
          />
        </FieldGroup>
      </FieldRow>
    </div>
  );
}
