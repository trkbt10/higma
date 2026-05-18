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

/**
 * Property rows are stacked (name above value) so long property names
 * (e.g. "Background variant", "Show secondary action label") can never
 * push their input off the row. The previous layout used a single flex
 * row with `flexShrink: 0` on the name, which silently squeezed Selects
 * and Inputs to a few pixels of width when the panel was narrow or the
 * name long. The new layout always gives the input the full panel width,
 * matching the pattern used by every other Number-with-Suffix section.
 */
const styles = {
  row: {
    display: "flex",
    flexDirection: "column" as const,
    gap: spacingTokens["2xs"],
    padding: `${spacingTokens.xs} 0`,
    borderBottom: `1px solid ${colorTokens.border.subtle}`,
  } as const,
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: spacingTokens.xs,
    minWidth: 0,
  } as const,
  name: {
    fontSize: fontTokens.size.sm,
    color: colorTokens.text.primary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: 1,
  } as const,
  valueRow: {
    display: "flex",
    alignItems: "center",
    gap: spacingTokens.xs,
    minWidth: 0,
  } as const,
  overridden: {
    fontWeight: fontTokens.weight.semibold,
  } as const,
  // Type chip ("TEXT" / "BOOL" / "NUMBER"). text.primary on bg.tertiary
  // = 15.4:1 (AAA). Previously text.tertiary at 2.34:1 (below AA).
  badge: {
    fontSize: fontTokens.size.xs,
    color: colorTokens.text.primary,
    backgroundColor: colorTokens.background.tertiary,
    borderRadius: "3px",
    padding: `0 ${spacingTokens.xs}`,
    flexShrink: 0,
    fontWeight: fontTokens.weight.medium,
  } as const,
  // Override chip is a STRUCTURAL signal ("this prop is overridden").
  // The previous design layered text.tertiary on accent.secondary
  // (1.39:1 — essentially invisible). The new outline style keeps
  // accent.secondary as the identity colour (border + dark text) while
  // achieving 17.4:1 (AAA) against the panel background.
  overrideBadge: {
    fontSize: fontTokens.size.xs,
    color: colorTokens.text.primary,
    backgroundColor: "transparent",
    border: `1px solid ${colorTokens.accent.secondary}`,
    borderRadius: "3px",
    padding: `0 ${spacingTokens.xs}`,
    flexShrink: 0,
    fontWeight: fontTokens.weight.semibold,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  } as const,
  empty: {
    fontSize: fontTokens.size.sm,
    color: colorTokens.text.tertiary,
    fontStyle: "italic" as const,
    padding: `${spacingTokens.sm} 0`,
  } as const,
  // "Component: Header/Primary" — names which component this instance
  // resolves to. Operationally important. text.primary (17.4:1 AAA);
  // hierarchy below it is established by size (xs vs sm) and weight
  // (medium vs normal) rather than colour gradation.
  symbolName: {
    fontSize: fontTokens.size.xs,
    color: colorTokens.text.primary,
    marginBottom: spacingTokens.sm,
    fontWeight: fontTokens.weight.medium,
  } as const,
  valueWrap: {
    flex: 1,
    minWidth: 0,
  } as const,
} as const;

function renderOverrideBadge(isOverridden: boolean) {
  if (!isOverridden) {
    return null;
  }
  return <span style={styles.overrideBadge}>override</span>;
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
            <div style={styles.nameRow}>
              <span style={styles.name} title={prop.name}>{prop.name}</span>
              <span style={styles.badge}>{prop.type}</span>
              {badge}
            </div>
            <div style={{ ...styles.valueRow, ...overrideStyle }}>
              {prop.type === "BOOL" && prop.value.kind === "bool" && (
                <input
                  type="checkbox"
                  aria-label={controlLabel(prop)}
                  checked={prop.value.value}
                  onChange={(e) => onValueChange(prop.id, { kind: "bool", value: e.currentTarget.checked })}
                />
              )}
              {prop.type === "TEXT" && prop.value.kind === "text" && (
                <div style={styles.valueWrap}>
                  <Input
                    type="text"
                    ariaLabel={controlLabel(prop)}
                    value={prop.value.value}
                    onChange={(v) => onValueChange(prop.id, { kind: "text", value: String(v) })}
                  />
                </div>
              )}
              {prop.type === "NUMBER" && prop.value.kind === "number" && (
                <div style={styles.valueWrap}>
                  <Input
                    type="number"
                    ariaLabel={controlLabel(prop)}
                    value={prop.value.value}
                    onChange={(v) => onValueChange(prop.id, { kind: "number", value: v as number })}
                  />
                </div>
              )}
              {prop.type === "INSTANCE_SWAP" && prop.value.kind === "reference" && (
                <div style={styles.valueWrap}>
                  <Select
                    value={prop.value.value}
                    onChange={(v) => onValueChange(prop.id, { kind: "reference", value: v })}
                    options={instanceSwapOptions}
                    ariaLabel={controlLabel(prop)}
                  />
                </div>
              )}
              {prop.type === "VARIANT" && prop.value.kind === "reference" && (
                <div style={styles.valueWrap}>
                  <Select
                    value={prop.value.value}
                    onChange={(v) => onValueChange(prop.id, { kind: "reference", value: v })}
                    options={referenceOptions}
                    ariaLabel={controlLabel(prop)}
                  />
                </div>
              )}
              {(prop.type === "COLOR" || prop.type === "IMAGE" || prop.type === "SLOT") && prop.value.kind === "reference" && (
                <div style={styles.valueWrap}>
                  <Input
                    type="text"
                    ariaLabel={controlLabel(prop)}
                    value={prop.value.value}
                    onChange={(v) => onValueChange(prop.id, { kind: "reference", value: String(v) })}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
