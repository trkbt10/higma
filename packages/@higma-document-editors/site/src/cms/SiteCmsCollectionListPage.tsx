/**
 * @file CMS workspace landing page — lists every collection extracted from the document.
 */

import type { BreadcrumbItem } from "@higma-editor-kernel/ui/editor";

import { siteBadgeStyle, siteCodeStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
import { SiteCmsDataTable, type SiteCmsTableColumn } from "./components/SiteCmsDataTable";
import { SiteCmsPageHeader } from "./components/SiteCmsPageHeader";
import {
  siteCmsPageContentStyle,
  siteCmsPageRootStyle,
} from "./components/site-cms-page-styles";
import type { SiteCollection } from "../domain/site-collections";

const breadcrumb: readonly BreadcrumbItem[] = [{ id: "collections", label: "Collections" }];

const columns: readonly SiteCmsTableColumn<SiteCollection>[] = [
  {
    id: "id",
    header: "Collection ID",
    render: (collection) => <span style={siteCodeStyle}>{collection.id}</span>,
  },
  {
    id: "fields",
    header: "Fields",
    align: "end",
    render: (collection) => <span style={siteBadgeStyle}>{collection.fields.length}</span>,
  },
  {
    id: "items",
    header: "Items",
    align: "end",
    render: (collection) => <span style={siteBadgeStyle}>{collection.items.length}</span>,
  },
  {
    id: "selectors",
    header: "Selectors",
    align: "end",
    render: (collection) => <span style={siteBadgeStyle}>{collection.selectors.length}</span>,
  },
];

/** List every CMS collection that the active site document references. */
export function SiteCmsCollectionListPage() {
  const { collections, goToCollection } = useSiteCms();

  return (
    <section style={siteCmsPageRootStyle} aria-label="Collections">
      <SiteCmsPageHeader
        title="Collections"
        description="Collections referenced by selectors and rich-text bindings inside this document."
        breadcrumb={breadcrumb}
      />
      <div style={siteCmsPageContentStyle}>
        <SiteCmsDataTable
          caption="Site CMS collections"
          columns={columns}
          rows={collections}
          rowKey={(collection) => collection.id}
          onRowClick={(collection) => goToCollection(collection.id)}
          emptyLabel="This document does not reference any CMS collection."
        />
      </div>
    </section>
  );
}
