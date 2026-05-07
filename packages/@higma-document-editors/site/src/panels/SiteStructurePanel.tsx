/**
 * @file Site layout structure panel.
 */

import type { CSSProperties } from "react";
import { colorTokens, fontTokens, radiusTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";

import { useSiteEditor } from "../context/SiteEditorContext";
import type { SiteEditableUnit } from "../site-editor-workspace";
import { getSiteRolePresentation } from "../domain/site-role-presentation";
import { siteBadgeStyle } from "./site-panel-styles";

const unitButtonStyle: CSSProperties = {
  width: "100%",
  border: "none",
  background: "transparent",
  color: colorTokens.text.primary,
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: spacingTokens.sm,
  minHeight: 30,
  borderRadius: radiusTokens.sm,
  cursor: "pointer",
  fontSize: fontTokens.size.md,
  textAlign: "left",
};

const selectedUnitButtonStyle: CSSProperties = {
  ...unitButtonStyle,
  background: colorTokens.selection.primary,
  color: colorTokens.text.inverse,
};

const UNIT_DEPTH_INDENT = 10;
const UNIT_BASE_PADDING = 8;

function unitPaddingLeft(unit: SiteEditableUnit): number {
  return UNIT_BASE_PADDING + unit.depth * UNIT_DEPTH_INDENT;
}

function getUnitButtonStyle(unit: SiteEditableUnit, selectedUnitId: string): CSSProperties {
  const baseStyle = getBaseUnitButtonStyle(unit, selectedUnitId);
  return {
    ...baseStyle,
    padding: `0 ${spacingTokens.sm} 0 ${unitPaddingLeft(unit)}px`,
  };
}

function getBaseUnitButtonStyle(unit: SiteEditableUnit, selectedUnitId: string): CSSProperties {
  if (unit.id === selectedUnitId) {
    return selectedUnitButtonStyle;
  }
  return unitButtonStyle;
}

function UnitRoleBadge({ unit }: { readonly unit: SiteEditableUnit }) {
  const presentation = getSiteRolePresentation(unit.role);
  return <span style={{ ...siteBadgeStyle, color: presentation.accentColor }}>{presentation.shortLabel}</span>;
}

/** Show selectable site layout render units. */
export function SiteStructurePanel() {
  const { editableUnits, selectedUnitId, setSelectedUnitId } = useSiteEditor();

  return (
    <OptionalPropertySection title="Structure" badge={editableUnits.length} defaultExpanded>
      <div role="tree" aria-label="Site layout structure">
        {editableUnits.map((unit) => (
          <button
            key={unit.id}
            type="button"
            role="treeitem"
            aria-selected={unit.id === selectedUnitId}
            style={getUnitButtonStyle(unit, selectedUnitId)}
            onClick={() => setSelectedUnitId(unit.id)}
          >
            <span>{unit.label}</span>
            <UnitRoleBadge unit={unit} />
          </button>
        ))}
      </div>
    </OptionalPropertySection>
  );
}
