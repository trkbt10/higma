/**
 * @file CMS workspace root — routes between list, table and detail pages.
 */

import type { CSSProperties } from "react";
import { colorTokens } from "@higma-editor-kernel/ui/design-tokens";

import { SiteCmsProvider, useSiteCms } from "./SiteCmsContext";
import { SiteCmsCollectionListPage } from "./SiteCmsCollectionListPage";
import { SiteCmsCollectionTablePage } from "./SiteCmsCollectionTablePage";
import { SiteCmsFieldDetailPage } from "./SiteCmsFieldDetailPage";
import { SiteCmsItemDetailPage } from "./SiteCmsItemDetailPage";

const workspaceStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  background: colorTokens.background.secondary,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

function SiteCmsRouter() {
  const { route } = useSiteCms();
  switch (route.kind) {
    case "list":
      return <SiteCmsCollectionListPage />;
    case "collection":
      return <SiteCmsCollectionTablePage collectionId={route.collectionId} tab={route.tab} />;
    case "field":
      return <SiteCmsFieldDetailPage collectionId={route.collectionId} fieldId={route.fieldId} />;
    case "item":
      return <SiteCmsItemDetailPage collectionId={route.collectionId} itemId={route.itemId} />;
  }
}

/** CMS-focused workspace surface used in place of the canvas when CMS view is active. */
export function SiteCmsWorkspace() {
  return (
    <SiteCmsProvider>
      <div style={workspaceStyle}>
        <SiteCmsRouter />
      </div>
    </SiteCmsProvider>
  );
}
