/** @file Variant Set authoring view (presentational only). */

import { Input } from "../../primitives";
import { FieldGroup, FieldRow } from "../../layout";

export type VariantDefView = {
  readonly id: string;
  readonly name: string;
};

export type VariantChildValueView = {
  readonly childId: string;
  readonly defId: string;
  readonly childName: string;
  readonly defName: string;
  readonly value: string;
};

export type ComponentSetVariantsSectionViewProps = {
  readonly variantDefs: readonly VariantDefView[];
  readonly childValues: readonly VariantChildValueView[];
  readonly onDefNameChange: (defId: string, name: string) => void;
  readonly onChildValueChange: (childId: string, defId: string, value: string) => void;
};

/** Renders variant property definitions and child variant values. */
export function ComponentSetVariantsSectionView({
  variantDefs,
  childValues,
  onDefNameChange,
  onChildValueChange,
}: ComponentSetVariantsSectionViewProps) {
  if (variantDefs.length === 0 && childValues.length === 0) {
    return <div>No variants defined</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {variantDefs.map((def, index) => (
        <FieldRow key={def.id}>
          <FieldGroup label={`Property ${index + 1}`} inline labelWidth={80}>
            <Input
              type="text"
              ariaLabel={`Variant property name ${index + 1}`}
              value={def.name}
              onChange={(value) => onDefNameChange(def.id, String(value))}
            />
          </FieldGroup>
        </FieldRow>
      ))}
      {childValues.map((entry, index) => (
        <FieldRow key={`${entry.childId}:${entry.defId}`}>
          <FieldGroup label={`${entry.childName} ${entry.defName}`} inline labelWidth={140}>
            <Input
              type="text"
              ariaLabel={`Variant ${entry.childName} value ${index + 1}`}
              value={entry.value}
              onChange={(value) => onChildValueChange(entry.childId, entry.defId, String(value))}
            />
          </FieldGroup>
        </FieldRow>
      ))}
    </div>
  );
}
