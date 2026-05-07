/**
 * @file Detail page for a single CMS item reference.
 */

import { useCallback, useMemo } from "react";
import type { BreadcrumbItem } from "@higma-editor-kernel/ui/editor";
import { Button } from "@higma-editor-kernel/ui/primitives/Button";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";

import { siteBadgeStyle, siteCodeStyle } from "../panels/site-panel-styles";
import { SitePropertyRow } from "../panels/SitePanelRow";
import { useSiteCms } from "./SiteCmsContext";
import { SiteCmsDataTable, type SiteCmsTableColumn } from "./components/SiteCmsDataTable";
import { SiteCmsPageHeader } from "./components/SiteCmsPageHeader";
import {
  siteCmsPageContentStyle,
  siteCmsPageRootStyle,
} from "./components/site-cms-page-styles";
import { useSiteEditor } from "../context/SiteEditorContext";
import {
  findSiteCollection,
  findSiteCollectionItem,
  type SiteCollectionItemBinding,
} from "../domain/site-collections";
import { getSiteRolePresentation } from "../domain/site-role-presentation";

const COLLECTIONS_BREADCRUMB_ID = "collections";

function describeItemId(itemId: string): string {
  if (itemId === "") {
    return "<context-bound>";
  }
  return itemId;
}

function buildBindingColumns(
  collectionId: string,
  onSelectField: (fieldId: string) => void,
): readonly SiteCmsTableColumn<SiteCollectionItemBinding>[] {
  return [
    {
      id: "field",
      header: "Field",
      render: (binding) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onSelectField(binding.fieldId);
          }}
          title={`Open field ${binding.fieldId} in collection ${collectionId}`}
        >
          <span style={siteCodeStyle}>{binding.fieldId}</span>
        </Button>
      ),
    },
    {
      id: "unit",
      header: "Consumer unit",
      render: (binding) => {
        const presentation = getSiteRolePresentation(binding.unitRole);
        return (
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span>{binding.unitLabel}</span>
            <span style={{ ...siteCodeStyle, color: presentation.accentColor }}>{presentation.label}</span>
          </span>
        );
      },
    },
    {
      id: "source",
      header: "Source",
      render: (binding) => <span style={siteCodeStyle}>{binding.source}</span>,
    },
    {
      id: "variable-field",
      header: "Variable field",
      render: (binding) => <span style={siteCodeStyle}>{binding.variableField}</span>,
    },
    {
      id: "data-type",
      header: "Data type",
      render: (binding) => (
        <span style={siteCodeStyle}>{binding.dataType} → {binding.resolvedDataType}</span>
      ),
    },
  ];
}

export type SiteCmsItemDetailPageProps = {
  readonly collectionId: string;
  readonly itemId: string;
};

/** Detail editor for a CMS item, showing every binding that targets it. */
export function SiteCmsItemDetailPage({ collectionId, itemId }: SiteCmsItemDetailPageProps) {
  const { collections, goToList, goToCollection, goToField } = useSiteCms();
  const { setSelectedUnitId } = useSiteEditor();

  const collection = useMemo(() => findSiteCollection(collections, collectionId), [collections, collectionId]);
  const item = useMemo(() => findSiteCollectionItem(collection, itemId), [collection, itemId]);

  const breadcrumb: readonly BreadcrumbItem[] = [
    { id: COLLECTIONS_BREADCRUMB_ID, label: "Collections" },
    { id: collection.id, label: collection.id },
    { id: item.id || "<context>", label: describeItemId(item.id) },
  ];

  const handleBreadcrumb = useCallback(
    (id: string) => {
      if (id === COLLECTIONS_BREADCRUMB_ID) {
        goToList();
        return;
      }
      if (id === collection.id) {
        goToCollection(collection.id, "items");
      }
    },
    [collection.id, goToCollection, goToList],
  );

  const handleSelectField = useCallback(
    (fieldId: string) => {
      goToField(collection.id, fieldId);
    },
    [collection.id, goToField],
  );

  const handleBindingClick = useCallback(
    (binding: SiteCollectionItemBinding) => {
      setSelectedUnitId(binding.unitId);
    },
    [setSelectedUnitId],
  );

  const bindingColumns = useMemo(
    () => buildBindingColumns(collection.id, handleSelectField),
    [collection.id, handleSelectField],
  );

  return (
    <section style={siteCmsPageRootStyle} aria-label={`Item ${describeItemId(item.id)}`}>
      <SiteCmsPageHeader
        title="Item"
        description={`Item ${describeItemId(item.id)} in collection ${collection.id}.`}
        breadcrumb={breadcrumb}
        onBreadcrumbClick={handleBreadcrumb}
        trailing={<span style={siteBadgeStyle}>{item.bindings.length} bindings</span>}
      />
      <div style={siteCmsPageContentStyle}>
        <OptionalPropertySection title="Identity" defaultExpanded>
          <SitePropertyRow label="Item ID" value={describeItemId(item.id)} />
          <SitePropertyRow label="Collection" value={collection.id} />
        </OptionalPropertySection>
        <OptionalPropertySection title="Bindings" badge={item.bindings.length} defaultExpanded>
          <SiteCmsDataTable
            caption={`Bindings to item ${describeItemId(item.id)}`}
            columns={bindingColumns}
            rows={item.bindings}
            rowKey={(binding) => `${binding.source}:${binding.unitId}:${binding.fieldId}:${binding.variableField}`}
            onRowClick={handleBindingClick}
            emptyLabel="This item has no bindings."
          />
        </OptionalPropertySection>
      </div>
    </section>
  );
}
