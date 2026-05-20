/** @file Instance overrides view (presentational only). */

import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";

export type InstanceOverrideRowView = {
  /** Stable key — caller chooses (path join, GUID string, etc.). */
  readonly key: string;
  readonly label: string;
  /** Opacity expressed as 0-100 percent. */
  readonly opacityPercent: number;
};

export type InstanceOverridesSectionViewProps = {
  readonly selfRow: InstanceOverrideRowView;
  readonly childRows: readonly InstanceOverrideRowView[];
  readonly onOpacityChange: (key: string, opacityPercent: number) => void;
};

/**
 * Parses a percentage-shaped input value to a number, or returns undefined
 * when the input cannot be interpreted. Callers decide whether the value is
 * acceptable before committing it to their document state.
 */
export function parsePercentInput(value: string | number): number | undefined {
  const raw = String(value).trim();
  if (raw.length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

/** Renders self + nested-child opacity overrides for an INSTANCE. */
export function InstanceOverridesSectionView({
  selfRow,
  childRows,
  onOpacityChange,
}: InstanceOverridesSectionViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldRow>
        <FieldGroup label={selfRow.label} inline labelWidth={104}>
          <Input
            type="text"
            ariaLabel="Instance override opacity"
            value={selfRow.opacityPercent}
            suffix="%"
            width={80}
            onChange={(value) => {
              const parsed = parsePercentInput(value);
              if (parsed === undefined) {
                return;
              }
              onOpacityChange(selfRow.key, parsed);
            }}
          />
        </FieldGroup>
      </FieldRow>
      {childRows.map((row) => (
        <FieldRow key={row.key}>
          <FieldGroup label={row.label} inline labelWidth={160}>
            <Input
              type="text"
              ariaLabel={`Override ${row.label} opacity`}
              value={row.opacityPercent}
              suffix="%"
              width={80}
              onChange={(value) => {
                const parsed = parsePercentInput(value);
                if (parsed === undefined) {
                  return;
                }
                onOpacityChange(row.key, parsed);
              }}
            />
          </FieldGroup>
        </FieldRow>
      ))}
    </div>
  );
}
