/** @file Component properties view (presentational only). */

import { Input, Select } from "../../primitives";
import type { SelectOption } from "../../types";
import { colorTokens, fontTokens, spacingTokens } from "../../design-tokens";

export type ComponentPropertyTypeId =
  | "BOOL"
  | "TEXT"
  | "NUMBER"
  | "INSTANCE_SWAP"
  | "VARIANT"
  | "COLOR"
  | "IMAGE"
  | "SLOT";

export type ComponentPropertyValueView =
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "reference"; readonly value: string };

export type ResolvedComponentPropertyView = {
  readonly id: string;
  readonly name: string;
  readonly type: ComponentPropertyTypeId;
  readonly value: ComponentPropertyValueView;
  readonly isOverridden: boolean;
};

export type ComponentPropertiesSectionViewProps = {
  readonly componentName?: string;
  readonly properties: readonly ResolvedComponentPropertyView[];
  readonly referenceOptions: readonly SelectOption<string>[];
  readonly instanceSwapOptions: readonly SelectOption<string>[];
  readonly onValueChange: (propertyId: string, value: ComponentPropertyValueView) => void;
};

const styles = {
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: `${spacingTokens.xs} 0`,
    borderBottom: `1px solid ${colorTokens.border.subtle}`,
    gap: spacingTokens.sm,
  } as const,
  name: {
    fontSize: fontTokens.size.sm,
    color: colorTokens.text.secondary,
    flexShrink: 0,
  } as const,
  value: {
    fontSize: fontTokens.size.sm,
    color: colorTokens.text.primary,
    textAlign: "right" as const,
    wordBreak: "break-word" as const,
    minWidth: 0,
  } as const,
  overridden: {
    fontWeight: fontTokens.weight.semibold,
  } as const,
  badge: {
    fontSize: fontTokens.size.xs,
    color: colorTokens.text.tertiary,
    backgroundColor: colorTokens.background.tertiary,
    borderRadius: "3px",
    padding: `0 ${spacingTokens.xs}`,
    marginLeft: spacingTokens.xs,
  } as const,
  empty: {
    fontSize: fontTokens.size.sm,
    color: colorTokens.text.tertiary,
    fontStyle: "italic" as const,
    padding: `${spacingTokens.sm} 0`,
  } as const,
  symbolName: {
    fontSize: fontTokens.size.xs,
    color: colorTokens.text.tertiary,
    marginBottom: spacingTokens.sm,
  } as const,
} as const;

function renderOverrideBadge(isOverridden: boolean) {
  if (!isOverridden) {
    return null;
  }
  return (
    <span style={{ ...styles.badge, backgroundColor: colorTokens.accent.secondary }}>
      override
    </span>
  );
}

function controlLabel(prop: ResolvedComponentPropertyView): string {
  return `Component property ${prop.name}`;
}

/** Renders resolved component-instance properties with override indicators. */
export function ComponentPropertiesSectionView({
  componentName,
  properties,
  referenceOptions,
  instanceSwapOptions,
  onValueChange,
}: ComponentPropertiesSectionViewProps) {
  if (properties.length === 0) {
    return (
      <div>
        {componentName && (
          <div style={styles.symbolName}>
            Component: {componentName}
          </div>
        )}
        <div style={styles.empty}>No component properties defined</div>
      </div>
    );
  }

  return (
    <div>
      {componentName && (
        <div style={styles.symbolName}>
          Component: {componentName}
        </div>
      )}
      {properties.map((prop) => {
        const badge = renderOverrideBadge(prop.isOverridden);
        const overrideStyle = prop.isOverridden ? styles.overridden : {};
        return (
          <div key={prop.id} style={styles.row}>
            <span style={styles.name}>
              {prop.name}
              <span style={styles.badge}>{prop.type}</span>
            </span>
            {prop.type === "BOOL" && prop.value.kind === "bool" && (
              <span style={styles.value}>
                <input
                  type="checkbox"
                  aria-label={controlLabel(prop)}
                  checked={prop.value.value}
                  onChange={(e) => onValueChange(prop.id, { kind: "bool", value: e.currentTarget.checked })}
                />
                {badge}
              </span>
            )}
            {prop.type === "TEXT" && prop.value.kind === "text" && (
              <span style={{ ...styles.value, ...overrideStyle }}>
                <Input
                  type="text"
                  ariaLabel={controlLabel(prop)}
                  value={prop.value.value}
                  onChange={(v) => onValueChange(prop.id, { kind: "text", value: String(v) })}
                />
                {badge}
              </span>
            )}
            {prop.type === "NUMBER" && prop.value.kind === "number" && (
              <span style={{ ...styles.value, ...overrideStyle }}>
                <Input
                  type="number"
                  ariaLabel={controlLabel(prop)}
                  value={prop.value.value}
                  onChange={(v) => onValueChange(prop.id, { kind: "number", value: v as number })}
                />
                {badge}
              </span>
            )}
            {prop.type === "INSTANCE_SWAP" && prop.value.kind === "reference" && (
              <span style={{ ...styles.value, ...overrideStyle }}>
                <Select
                  value={prop.value.value}
                  onChange={(v) => onValueChange(prop.id, { kind: "reference", value: v })}
                  options={instanceSwapOptions}
                  ariaLabel={controlLabel(prop)}
                />
                {badge}
              </span>
            )}
            {prop.type === "VARIANT" && prop.value.kind === "reference" && (
              <span style={{ ...styles.value, ...overrideStyle }}>
                <Select
                  value={prop.value.value}
                  onChange={(v) => onValueChange(prop.id, { kind: "reference", value: v })}
                  options={referenceOptions}
                  ariaLabel={controlLabel(prop)}
                />
                {badge}
              </span>
            )}
            {(prop.type === "COLOR" || prop.type === "IMAGE" || prop.type === "SLOT") && prop.value.kind === "reference" && (
              <span style={{ ...styles.value, ...overrideStyle }}>
                <Input
                  type="text"
                  ariaLabel={controlLabel(prop)}
                  value={prop.value.value}
                  onChange={(v) => onValueChange(prop.id, { kind: "reference", value: String(v) })}
                />
                {badge}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
