/**
 * @file CMS workspace navigation context.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useSiteEditor } from "../context/SiteEditorContext";
import {
  extractSiteCollections,
  findSiteCollection,
  findSiteCollectionField,
  findSiteCollectionItem,
  type SiteCollection,
} from "../domain/site-collections";
import {
  DEFAULT_SITE_CMS_COLLECTION_TAB,
  DEFAULT_SITE_CMS_ROUTE,
  type SiteCmsCollectionTab,
  type SiteCmsRoute,
} from "./SiteCmsRoute";

export type SiteCmsContextValue = {
  readonly collections: readonly SiteCollection[];
  readonly route: SiteCmsRoute;
  readonly goToList: () => void;
  readonly goToCollection: (collectionId: string, tab?: SiteCmsCollectionTab) => void;
  readonly goToCollectionTab: (tab: SiteCmsCollectionTab) => void;
  readonly goToField: (collectionId: string, fieldId: string) => void;
  readonly goToItem: (collectionId: string, itemId: string) => void;
};

const SiteCmsContext = createContext<SiteCmsContextValue | null>(null);

function assertCollectionExists(collections: readonly SiteCollection[], collectionId: string): void {
  findSiteCollection(collections, collectionId);
}

function assertFieldExists(collections: readonly SiteCollection[], collectionId: string, fieldId: string): void {
  findSiteCollectionField(findSiteCollection(collections, collectionId), fieldId);
}

function assertItemExists(collections: readonly SiteCollection[], collectionId: string, itemId: string): void {
  findSiteCollectionItem(findSiteCollection(collections, collectionId), itemId);
}

/** Provide CMS collections and the active CMS workspace route. */
export function SiteCmsProvider({ children }: { readonly children: ReactNode }) {
  const { workspace } = useSiteEditor();
  const collections = useMemo(() => extractSiteCollections(workspace), [workspace]);
  const [route, setRoute] = useState<SiteCmsRoute>(DEFAULT_SITE_CMS_ROUTE);

  const goToList = useCallback(() => {
    setRoute({ kind: "list" });
  }, []);

  const goToCollection = useCallback(
    (collectionId: string, tab: SiteCmsCollectionTab = DEFAULT_SITE_CMS_COLLECTION_TAB) => {
      assertCollectionExists(collections, collectionId);
      setRoute({ kind: "collection", collectionId, tab });
    },
    [collections],
  );

  const goToCollectionTab = useCallback((tab: SiteCmsCollectionTab) => {
    setRoute((current) => {
      if (current.kind !== "collection") {
        throw new Error("Cannot change CMS collection tab outside of a collection route");
      }
      return { ...current, tab };
    });
  }, []);

  const goToField = useCallback(
    (collectionId: string, fieldId: string) => {
      assertFieldExists(collections, collectionId, fieldId);
      setRoute({ kind: "field", collectionId, fieldId });
    },
    [collections],
  );

  const goToItem = useCallback(
    (collectionId: string, itemId: string) => {
      assertItemExists(collections, collectionId, itemId);
      setRoute({ kind: "item", collectionId, itemId });
    },
    [collections],
  );

  const value = useMemo<SiteCmsContextValue>(
    () => ({ collections, route, goToList, goToCollection, goToCollectionTab, goToField, goToItem }),
    [collections, route, goToList, goToCollection, goToCollectionTab, goToField, goToItem],
  );

  return <SiteCmsContext.Provider value={value}>{children}</SiteCmsContext.Provider>;
}

/** Read the active CMS workspace context. */
export function useSiteCms(): SiteCmsContextValue {
  const value = useContext(SiteCmsContext);
  if (!value) {
    throw new Error("useSiteCms must be used within SiteCmsProvider");
  }
  return value;
}
