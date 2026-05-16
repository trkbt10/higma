/**
 * @file Corner radius section view (presentational only)
 *
 * Renders either a uniform radius input or four individual corner inputs
 * (TL/TR/BR/BL). The "mode" decision and toggle handlers belong to the caller.
 */

import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";

/** Tuple ordered as TL, TR, BR, BL — matches Figma corner radius storage. */
export type CornerRadiusTuple = readonly [number, number, number, number];
export type CornerRadiusIndex = 0 | 1 | 2 | 3;

const modeButtonStyle = {
  height: 26,
  minWidth: 72,
  border: "1px solid var(--border-subtle, #d0d0d0)",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
  fontSize: 11,
} as const;

export type CornerRadiusSectionViewProps = {
  readonly mode: "uniform" | "individual";
  readonly uniformRadius: number;
  readonly individualRadii: CornerRadiusTuple;
  readonly onUniformChange: (value: number) => void;
  readonly onIndividualChange: (index: CornerRadiusIndex, value: number) => void;
  readonly onSwitchToIndividual: () => void;
  readonly onSwitchToUniform: () => void;
};

/** Renders uniform or per-corner radius inputs and a mode toggle. */
export function CornerRadiusSectionView({
  mode,
  uniformRadius,
  individualRadii,
  onUniformChange,
  onIndividualChange,
  onSwitchToIndividual,
  onSwitchToUniform,
}: CornerRadiusSectionViewProps) {
  if (mode === "individual") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <FieldRow>
          <FieldGroup label="TL" inline labelWidth={20}>
            <Input
              type="number"
              value={individualRadii[0]}
              min={0}
              step={1}
              width={56}
              onChange={(v) => onIndividualChange(0, v as number)}
            />
          </FieldGroup>
          <FieldGroup label="TR" inline labelWidth={20}>
            <Input
              type="number"
              value={individualRadii[1]}
              min={0}
              step={1}
              width={56}
              onChange={(v) => onIndividualChange(1, v as number)}
            />
          </FieldGroup>
        </FieldRow>
        <FieldRow>
          <FieldGroup label="BL" inline labelWidth={20}>
            <Input
              type="number"
              value={individualRadii[3]}
              min={0}
              step={1}
              width={56}
              onChange={(v) => onIndividualChange(3, v as number)}
            />
          </FieldGroup>
          <FieldGroup label="BR" inline labelWidth={20}>
            <Input
              type="number"
              value={individualRadii[2]}
              min={0}
              step={1}
              width={56}
              onChange={(v) => onIndividualChange(2, v as number)}
            />
          </FieldGroup>
        </FieldRow>
        <FieldRow>
          <button
            type="button"
            aria-label="Use uniform corner radius"
            title="Use uniform corner radius"
            style={modeButtonStyle}
            onClick={onSwitchToUniform}
          >
            Uniform
          </button>
        </FieldRow>
      </div>
    );
  }

  return (
    <FieldRow>
      <FieldGroup label="Radius" inline labelWidth={50}>
        <Input
          type="number"
          value={uniformRadius}
          min={0}
          step={1}
          onChange={(v) => onUniformChange(v as number)}
          width={80}
        />
      </FieldGroup>
      <button
        type="button"
        aria-label="Use individual corner radii"
        title="Use individual corner radii"
        style={modeButtonStyle}
        onClick={onSwitchToIndividual}
      >
        Corners
      </button>
    </FieldRow>
  );
}
