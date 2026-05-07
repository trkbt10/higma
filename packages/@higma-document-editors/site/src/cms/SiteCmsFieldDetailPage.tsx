/**
 * @file Detail page for a single CMS field.
 */

import { useCallback, useMemo } from "react";
import type { BreadcrumbItem } from "@higma-editor-kernel/ui/editor";
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
  findSiteCollectionField,
  type SiteCollectionFieldUsage,
} from "../domain/site-collections";
import { getSiteRolePresentation } from "../domain/site-role-presentation";

const COLLECTIONS_BREADCRUMB_ID = "collections";

function describeItemId(itemId: string): string {
  if (itemId === "") {
    return "<context-bound>";
  }
  return itemId;
}

function uniqueValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

const usageColumns: readonly SiteCmsTableColumn<SiteCollectionFieldUsage>[] = [
  {
    id: "unit",
    header: "Consumer unit",
    render: (usage) => {
      const presentation = getSiteRolePresentation(usage.unitRole);
      return (
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span>{usage.unitLabel}</span>
          <span style={{ ...siteCodeStyle, color: presentation.accentColor }}>{presentation.label}</span>
        </span>
      );
    },
  },
  {
    id: "source",
    header: "Source",
    render: (usage) => <span style={siteCodeStyle}>{usage.source}</span>,
  },
  {
    id: "variable-field",
    header: "Variable field",
    render: (usage) => <span style={siteCodeStyle}>{usage.variableField}</span>,
  },
  {
    id: "data-type",
    header: "Data type",
    render: (usage) => (
      <span style={siteCodeStyle}>{usage.dataType} → {usage.resolvedDataType}</span>
    ),
  },
  {
    id: "item",
    header: "Item",
    render: (usage) => <span style={siteCodeStyle}>{describeItemId(usage.itemId)}</span>,
  },
];

export type SiteCmsFieldDetailPageProps = {
  readonly collectionId: string;
  readonly fieldId: string;
};

/** Detail editor for a CMS field, exposing usage references and metadata. */
export function SiteCmsFieldDetailPage({ collectionId, fieldId }: SiteCmsFieldDetailPageProps) {
  const { collections, goToList, goToCollection } = useSiteCms();
  const { setSelectedUnitId } = useSiteEditor();

  const collection = useMemo(() => findSiteCollection(collections, collectionId), [collections, collectionId]);
  const field = useMemo(() => findSiteCollectionField(collection, fieldId), [collection, fieldId]);

  const variableFields = useMemo(
    () => uniqueValues(field.usages.map((usage) => usage.variableField)),
    [field.usages],
  );
  const dataTypes = useMemo(
    () => uniqueValues(field.usages.map((usage) => usage.dataType)),
    [field.usages],
  );
  const resolvedDataTypes = useMemo(
    () => uniqueValues(field.usages.map((usage) => usage.resolvedDataType)),
    [field.usages],
  );

  const breadcrumb: readonly BreadcrumbItem[] = [
    { id: COLLECTIONS_BREADCRUMB_ID, label: "Collections" },
    { id: collection.id, label: collection.id },
    { id: field.id, label: field.id },
  ];

  const handleBreadcrumb = useCallback(
    (id: string) => {
      if (id === COLLECTIONS_BREADCRUMB_ID) {
        goToList();
        return;
      }
      if (id === collection.id) {
        goToCollection(collection.id, "fields");
      }
    },
    [collection.id, goToCollection, goToList],
  );

  const handleUsageClick = useCallback(
    (usage: SiteCollectionFieldUsage) => {
      setSelectedUnitId(usage.unitId);
    },
    [setSelectedUnitId],
  );

  return (
    <section style={siteCmsPageRootStyle} aria-label={`Field ${field.id}`}>
      <SiteCmsPageHeader
        title="Field"
        description={`Field ${field.id} in collection ${collection.id}.`}
        breadcrumb={breadcrumb}
        onBreadcrumbClick={handleBreadcrumb}
        trailing={<span style={siteBadgeStyle}>{field.usages.length} usages</span>}
      />
      <div style={siteCmsPageContentStyle}>
        <OptionalPropertySection title="Identity" defaultExpanded>
          <SitePropertyRow label="Field ID" value={field.id} />
          <SitePropertyRow label="Collection" value={collection.id} />
          <SitePropertyRow label="Variable fields" value={variableFields.join(", ")} />
          <SitePropertyRow label="Data types" value={dataTypes.join(", ")} />
          <SitePropertyRow label="Resolved data types" value={resolvedDataTypes.join(", ")} />
        </OptionalPropertySection>
        <OptionalPropertySection title="Usages" badge={field.usages.length} defaultExpanded>
          <SiteCmsDataTable
            caption={`Usages of field ${field.id}`}
            columns={usageColumns}
            rows={field.usages}
            rowKey={(usage) => `${usage.source}:${usage.unitId}:${usage.variableField}:${usage.itemId}`}
            onRowClick={handleUsageClick}
            emptyLabel="This field has no recorded usage."
          />
        </OptionalPropertySection>
      </div>
    </section>
  );
}
