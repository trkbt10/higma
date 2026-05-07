/**
 * @file Per-collection table page — switches between fields, items and selectors.
 */

import { useCallback, useMemo } from "react";
import type { BreadcrumbItem } from "@higma-editor-kernel/ui/editor";
import { Tabs, type TabItem } from "@higma-editor-kernel/ui/primitives/Tabs";

import { siteBadgeStyle, siteCodeStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
import type { SiteCmsCollectionTab } from "./SiteCmsRoute";
import { SiteCmsDataTable, type SiteCmsTableColumn } from "./components/SiteCmsDataTable";
import { SiteCmsPageHeader } from "./components/SiteCmsPageHeader";
import {
  siteCmsPageContentStyle,
  siteCmsPageRootStyle,
} from "./components/site-cms-page-styles";
import {
  findSiteCollection,
  type SiteCollection,
  type SiteCollectionField,
  type SiteCollectionItem,
  type SiteCollectionSelector,
} from "../domain/site-collections";
import { getSiteRolePresentation } from "../domain/site-role-presentation";

const ROOT_BREADCRUMB_ID = "collections";

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

const fieldColumns: readonly SiteCmsTableColumn<SiteCollectionField>[] = [
  {
    id: "id",
    header: "Field ID",
    render: (field) => <span style={siteCodeStyle}>{field.id}</span>,
  },
  {
    id: "variable-fields",
    header: "Variable fields",
    render: (field) => <span>{uniqueValues(field.usages.map((usage) => usage.variableField)).join(", ")}</span>,
  },
  {
    id: "data-types",
    header: "Data types",
    render: (field) => <span>{uniqueValues(field.usages.map((usage) => usage.dataType)).join(", ")}</span>,
  },
  {
    id: "usages",
    header: "Usages",
    align: "end",
    render: (field) => <span style={siteBadgeStyle}>{field.usages.length}</span>,
  },
];

const itemColumns: readonly SiteCmsTableColumn<SiteCollectionItem>[] = [
  {
    id: "id",
    header: "Item ID",
    render: (item) => <span style={siteCodeStyle}>{describeItemId(item.id)}</span>,
  },
  {
    id: "fields",
    header: "Distinct fields",
    align: "end",
    render: (item) => {
      const distinct = new Set(item.bindings.map((binding) => binding.fieldId)).size;
      return <span style={siteBadgeStyle}>{distinct}</span>;
    },
  },
  {
    id: "bindings",
    header: "Bindings",
    align: "end",
    render: (item) => <span style={siteBadgeStyle}>{item.bindings.length}</span>,
  },
];

const selectorColumns: readonly SiteCmsTableColumn<SiteCollectionSelector>[] = [
  {
    id: "unit",
    header: "Unit",
    render: (selector) => {
      const presentation = getSiteRolePresentation(selector.unitRole);
      return (
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span>{selector.unitLabel}</span>
          <span style={{ ...siteCodeStyle, color: presentation.accentColor }}>{presentation.label}</span>
        </span>
      );
    },
  },
  {
    id: "match",
    header: "Match",
    render: (selector) => <span>{selector.matchType}</span>,
  },
  {
    id: "filters",
    header: "Filters",
    render: (selector) => {
      if (selector.filters.length === 0) {
        return <span style={{ opacity: 0.6 }}>—</span>;
      }
      return (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {selector.filters.map((filter) => (
            <span key={`${filter.fieldId}:${filter.operator}:${String(filter.comparisonValue)}`} style={siteCodeStyle}>
              {filter.fieldId} {filter.operator} {String(filter.comparisonValue)}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    id: "sorts",
    header: "Sorts",
    align: "end",
    render: (selector) => <span style={siteBadgeStyle}>{selector.sortCount}</span>,
  },
  {
    id: "limit",
    header: "Limit",
    align: "end",
    render: (selector) => <span style={siteBadgeStyle}>{selector.limit}</span>,
  },
];

function FieldsTab({ collection }: { readonly collection: SiteCollection }) {
  const { goToField } = useSiteCms();
  const handleSelect = useCallback(
    (field: SiteCollectionField) => {
      goToField(collection.id, field.id);
    },
    [collection.id, goToField],
  );
  return (
    <SiteCmsDataTable
      caption={`Fields of collection ${collection.id}`}
      columns={fieldColumns}
      rows={collection.fields}
      rowKey={(field) => field.id}
      onRowClick={handleSelect}
      emptyLabel="This collection has no field bindings."
    />
  );
}

function ItemsTab({ collection }: { readonly collection: SiteCollection }) {
  const { goToItem } = useSiteCms();
  const handleSelect = useCallback(
    (item: SiteCollectionItem) => {
      goToItem(collection.id, item.id);
    },
    [collection.id, goToItem],
  );
  return (
    <SiteCmsDataTable
      caption={`Items of collection ${collection.id}`}
      columns={itemColumns}
      rows={collection.items}
      rowKey={(item) => item.id}
      onRowClick={handleSelect}
      emptyLabel="This collection has no recorded item references."
    />
  );
}

function SelectorsTab({ collection }: { readonly collection: SiteCollection }) {
  return (
    <SiteCmsDataTable
      caption={`Selectors targeting collection ${collection.id}`}
      columns={selectorColumns}
      rows={collection.selectors}
      rowKey={(selector) => selector.unitId}
      emptyLabel="No selectors target this collection."
    />
  );
}

function buildTabs(collection: SiteCollection): readonly TabItem<SiteCmsCollectionTab>[] {
  return [
    {
      id: "fields",
      label: `Fields (${collection.fields.length})`,
      content: <FieldsTab collection={collection} />,
    },
    {
      id: "items",
      label: `Items (${collection.items.length})`,
      content: <ItemsTab collection={collection} />,
    },
    {
      id: "selectors",
      label: `Selectors (${collection.selectors.length})`,
      content: <SelectorsTab collection={collection} />,
    },
  ];
}

export type SiteCmsCollectionTablePageProps = {
  readonly collectionId: string;
  readonly tab: SiteCmsCollectionTab;
};

/** Show the table editor for a single collection, including fields, items, and selectors. */
export function SiteCmsCollectionTablePage({ collectionId, tab }: SiteCmsCollectionTablePageProps) {
  const { collections, goToList, goToCollectionTab } = useSiteCms();
  const collection = useMemo(() => findSiteCollection(collections, collectionId), [collections, collectionId]);
  const tabs = useMemo(() => buildTabs(collection), [collection]);

  const breadcrumb: readonly BreadcrumbItem[] = [
    { id: ROOT_BREADCRUMB_ID, label: "Collections" },
    { id: collection.id, label: collection.id },
  ];

  const handleBreadcrumb = useCallback(
    (id: string) => {
      if (id === ROOT_BREADCRUMB_ID) {
        goToList();
      }
    },
    [goToList],
  );

  return (
    <section style={siteCmsPageRootStyle} aria-label={`Collection ${collection.id}`}>
      <SiteCmsPageHeader
        title="Collection"
        description={`Edit fields, item references and selectors that consume ${collection.id}.`}
        breadcrumb={breadcrumb}
        onBreadcrumbClick={handleBreadcrumb}
      />
      <div style={siteCmsPageContentStyle}>
        <Tabs<SiteCmsCollectionTab>
          items={tabs}
          value={tab}
          onChange={goToCollectionTab}
          size="sm"
        />
      </div>
    </section>
  );
}
