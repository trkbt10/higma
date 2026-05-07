/**
 * @file Site selected unit properties panel.
 */

import type { SiteCmsBinding, SiteCmsSelectorBinding, SiteCmsRichTextBinding } from "@higma-document-renderers/site";
import { colorTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";

import { useSiteEditor } from "../context/SiteEditorContext";
import { getSiteRolePresentation } from "../domain/site-role-presentation";
import { SiteNumericPropertyRow, SitePropertyRow } from "./SitePanelRow";
import { siteBadgeStyle, sitePanelRootStyle } from "./site-panel-styles";

function formatBooleanFlag(value: boolean): string {
  if (value) {
    return "yes";
  }
  return "no";
}

function selectedBindings(bindings: readonly SiteCmsBinding[], unitId: string): readonly SiteCmsBinding[] {
  return bindings.filter((binding) => binding.unitId === unitId);
}

function SelectorBindingDetails({ binding }: { readonly binding: SiteCmsSelectorBinding }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacingTokens.xs }}>
      <SitePropertyRow label="Collection" value={binding.collectionId} />
      <SitePropertyRow label="Match" value={binding.matchType} />
      <SitePropertyRow label="Filters" value={binding.filters.length} />
      <SitePropertyRow label="Sorts" value={binding.sortCount} />
      <SitePropertyRow label="Limit" value={binding.limit} />
      {binding.filters.map((filter) => (
        <SitePropertyRow
          key={`${filter.fieldId}:${filter.operator}:${String(filter.comparisonValue)}`}
          label={filter.fieldId}
          value={`${filter.operator} ${String(filter.comparisonValue)}`}
        />
      ))}
    </div>
  );
}

function RichTextBindingDetails({ binding }: { readonly binding: SiteCmsRichTextBinding }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacingTokens.xs }}>
      <SitePropertyRow label="Aliases" value={binding.aliases.length} />
      <SitePropertyRow label="Styles" value={binding.styleClasses.join(", ")} />
      {binding.aliases.map((alias) => (
        <SitePropertyRow
          key={`${alias.source}:${alias.collectionId}:${alias.fieldId}:${alias.variableField}`}
          label={alias.variableField}
          value={`${alias.collectionId} / ${alias.fieldId}`}
        />
      ))}
    </div>
  );
}

function BindingDetails({ binding }: { readonly binding: SiteCmsBinding }) {
  if (binding.kind === "site-cms-selector-binding") {
    return <SelectorBindingDetails binding={binding} />;
  }
  return <RichTextBindingDetails binding={binding} />;
}

/** Show selected site unit properties and CMS binding details. */
export function SitePropertiesPanel() {
  const { workspace, editableUnits, selectedUnit, selectedUnitBounds, activeBreakpointName, setSelectedUnitPosition } = useSiteEditor();
  const role = getSiteRolePresentation(selectedUnit.role);
  const bindings = selectedBindings(workspace.cmsBindings, selectedUnit.id);

  return (
    <div style={{ ...sitePanelRootStyle, overflowY: "auto" }}>
      <OptionalPropertySection title="Selection" badge={role.shortLabel} defaultExpanded>
        <span style={{ ...siteBadgeStyle, alignSelf: "flex-start", color: role.accentColor }}>{role.label}</span>
        <SitePropertyRow label="Name" value={selectedUnit.label} />
        <SitePropertyRow label="ID" value={selectedUnit.id} />
        <SitePropertyRow label="Breakpoint" value={activeBreakpointName ?? "All"} />
        <SitePropertyRow label="Children" value={selectedUnit.childIds.length} />
        <SitePropertyRow label="Depth" value={selectedUnit.depth} />
      </OptionalPropertySection>

      <OptionalPropertySection title="Geometry" defaultExpanded>
        <SiteNumericPropertyRow
          label="X"
          value={selectedUnitBounds.x}
          onChange={(nextX) => setSelectedUnitPosition(nextX, selectedUnitBounds.y)}
        />
        <SiteNumericPropertyRow
          label="Y"
          value={selectedUnitBounds.y}
          onChange={(nextY) => setSelectedUnitPosition(selectedUnitBounds.x, nextY)}
        />
        <SitePropertyRow label="Width" value={Math.round(selectedUnitBounds.width)} />
        <SitePropertyRow label="Height" value={Math.round(selectedUnitBounds.height)} />
      </OptionalPropertySection>

      <OptionalPropertySection title="CMS Bindings" badge={bindings.length} defaultExpanded>
        {bindings.map((binding) => (
          <div key={`${binding.kind}:${binding.unitId}`} style={{ borderTop: `1px solid ${colorTokens.border.subtle}`, paddingTop: spacingTokens.sm }}>
            <BindingDetails binding={binding} />
          </div>
        ))}
      </OptionalPropertySection>

      <OptionalPropertySection title="Document" badge={workspace.overview.renderUnitCount} defaultExpanded={false}>
        <SitePropertyRow label="Nodes" value={workspace.overview.nodeCount} />
        <SitePropertyRow label="Visible units" value={editableUnits.length} />
        <SitePropertyRow label="Schema definitions" value={workspace.overview.schemaDefinitionCount} />
        <SitePropertyRow label="Render coordinates" value={formatBooleanFlag(workspace.overview.metadataFlags.hasRenderCoordinates)} />
        <SitePropertyRow label="Thumbnail size" value={formatBooleanFlag(workspace.overview.metadataFlags.hasThumbnailSize)} />
        <SitePropertyRow label="Export timestamp" value={formatBooleanFlag(workspace.overview.metadataFlags.hasExportTimestamp)} />
      </OptionalPropertySection>
    </div>
  );
}
