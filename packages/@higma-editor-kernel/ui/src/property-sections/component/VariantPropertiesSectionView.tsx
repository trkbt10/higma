/** @file Variant property metadata view (presentational only). */

import { Input } from "../../primitives";
import { FieldGroup } from "../../layout";

export type VariantPropertyView = {
  readonly id: string;
  readonly value: string;
};

export type VariantPropertiesSectionViewProps = {
  readonly specs: readonly VariantPropertyView[];
  readonly onChange: (id: string, value: string) => void;
};

/** Renders variant-property values for SYMBOL nodes. */
export function VariantPropertiesSectionView({ specs, onChange }: VariantPropertiesSectionViewProps) {
  if (specs.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {specs.map((spec, index) => (
        <FieldGroup key={spec.id} label={`Variant ${index + 1}`}>
          <Input
            type="text"
            ariaLabel={`Variant value ${index + 1}`}
            value={spec.value}
            onChange={(value) => onChange(spec.id, String(value))}
          />
        </FieldGroup>
      ))}
    </div>
  );
}
