/**
 * @file Corner radius section view (presentational only)
 *
 * Renders either a uniform radius input or four individual corner inputs
 * (TL/TR/BR/BL). The corner labels live in the prefix slot (drag scrubber);
 * the trailing `px` suffix carries the unit.
 *
 * Mode switching is exposed as a SuffixSelect placed in the uniform input's
 * suffix slot (replacing the unit when mode-switch UI is the priority).
 * Individual mode renders a separate "Uniform" button because there is no
 * single primary input to attach the mode switch to.
 */

import { Input, SuffixSelect } from "../../primitives";
import { FieldRow } from "../../layout";
import type { SelectOption } from "../../types";

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

type CornerModeId = "uniform" | "individual";

const CORNER_MODE_OPTIONS: readonly SelectOption<CornerModeId>[] = [
  { value: "uniform", label: "px" },
  { value: "individual", label: "Per-corner" },
];

export type CornerRadiusSectionViewProps = {
  readonly mode: CornerModeId;
  readonly uniformRadius: number;
  readonly individualRadii: CornerRadiusTuple;
  readonly onUniformChange: (value: number) => void;
  readonly onIndividualChange: (index: CornerRadiusIndex, value: number) => void;
  readonly onSwitchToIndividual: () => void;
  readonly onSwitchToUniform: () => void;
};

/** Renders uniform or per-corner radius inputs with prefix-label + unit-suffix layout. */
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
          <Input
            type="number"
            ariaLabel="Top-left corner radius"
            value={individualRadii[0]}
            min={0}
            step={1}
            prefix="TL"
            suffix="px"
            dragToChange
            onChange={(v) => onIndividualChange(0, v as number)}
          />
          <Input
            type="number"
            ariaLabel="Top-right corner radius"
            value={individualRadii[1]}
            min={0}
            step={1}
            prefix="TR"
            suffix="px"
            dragToChange
            onChange={(v) => onIndividualChange(1, v as number)}
          />
        </FieldRow>
        <FieldRow>
          <Input
            type="number"
            ariaLabel="Bottom-left corner radius"
            value={individualRadii[3]}
            min={0}
            step={1}
            prefix="BL"
            suffix="px"
            dragToChange
            onChange={(v) => onIndividualChange(3, v as number)}
          />
          <Input
            type="number"
            ariaLabel="Bottom-right corner radius"
            value={individualRadii[2]}
            min={0}
            step={1}
            prefix="BR"
            suffix="px"
            dragToChange
            onChange={(v) => onIndividualChange(2, v as number)}
          />
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
    <Input
      type="number"
      ariaLabel="Corner radius"
      value={uniformRadius}
      min={0}
      step={1}
      prefix="Radius"
      dragToChange
      onChange={(v) => onUniformChange(v as number)}
      suffix={
        <SuffixSelect
          value="uniform"
          options={CORNER_MODE_OPTIONS}
          onChange={(value) => {
            if (value === "individual") {
              onSwitchToIndividual();
            }
          }}
          ariaLabel="Corner radius mode"
        />
      }
    />
  );
}
