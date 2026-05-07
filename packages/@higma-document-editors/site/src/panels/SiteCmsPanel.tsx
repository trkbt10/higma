/**
 * @file Site CMS binding panel.
 */

import type { SiteCmsBinding } from "@higma-document-renderers/site";
import { colorTokens, fontTokens, radiusTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";

import { useSiteEditor } from "../context/SiteEditorContext";
import { getSiteRolePresentation } from "../domain/site-role-presentation";
import { siteBadgeStyle } from "./site-panel-styles";

function bindingTitle(binding: SiteCmsBinding): string {
  if (binding.kind === "site-cms-selector-binding") {
    return binding.collectionId;
  }
  const firstAlias = binding.aliases[0];
  if (firstAlias) {
    return `${firstAlias.collectionId} / ${firstAlias.fieldId}`;
  }
  return binding.unitLabel;
}

function bindingSubtitle(binding: SiteCmsBinding): string {
  if (binding.kind === "site-cms-selector-binding") {
    return `${binding.matchType} filters:${binding.filters.length}`;
  }
  return `aliases:${binding.aliases.length} styles:${binding.styleClasses.length}`;
}

function bindingBorderColor(active: boolean, accentColor: string): string {
  if (active) {
    return accentColor;
  }
  return colorTokens.border.subtle;
}

function bindingBackground(active: boolean): string {
  if (active) {
    return colorTokens.background.tertiary;
  }
  return colorTokens.background.primary;
}

/** List CMS bindings extracted from the site render plan. */
export function SiteCmsPanel() {
  const { workspace, editableUnits, selectedUnitId, setSelectedUnitId } = useSiteEditor();
  const activeUnitIds = new Set(editableUnits.map((unit) => unit.id));
  const cmsBindings = workspace.cmsBindings.filter((binding) => activeUnitIds.has(binding.unitId));

  return (
    <OptionalPropertySection title="CMS" badge={cmsBindings.length} defaultExpanded>
      <div style={{ display: "flex", flexDirection: "column", gap: spacingTokens["2xs"] }}>
        {cmsBindings.map((binding) => {
          const role = getSiteRolePresentation(binding.unitRole);
          const active = binding.unitId === selectedUnitId;
          return (
            <button
              key={`${binding.kind}:${binding.unitId}`}
              type="button"
              onClick={() => setSelectedUnitId(binding.unitId)}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: spacingTokens.xs,
                alignItems: "center",
                minHeight: 30,
                padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
                border: `1px solid ${bindingBorderColor(active, role.accentColor)}`,
                borderRadius: radiusTokens.sm,
                background: bindingBackground(active),
                color: colorTokens.text.primary,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {binding.unitLabel}
                </span>
                <span style={{ display: "block", color: colorTokens.text.secondary, fontSize: fontTokens.size.sm }}>
                  {bindingTitle(binding)}
                </span>
              </span>
              <span style={{ ...siteBadgeStyle, color: role.accentColor }}>{bindingSubtitle(binding)}</span>
            </button>
          );
        })}
      </div>
    </OptionalPropertySection>
  );
}
