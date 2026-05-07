/**
 * @file CMS workspace route definition.
 */

export type SiteCmsRoute =
  | { readonly kind: "list" }
  | { readonly kind: "collection"; readonly collectionId: string; readonly tab: SiteCmsCollectionTab }
  | { readonly kind: "field"; readonly collectionId: string; readonly fieldId: string }
  | { readonly kind: "item"; readonly collectionId: string; readonly itemId: string };

export type SiteCmsCollectionTab = "fields" | "items" | "selectors";

export const DEFAULT_SITE_CMS_ROUTE: SiteCmsRoute = { kind: "list" };

export const DEFAULT_SITE_CMS_COLLECTION_TAB: SiteCmsCollectionTab = "fields";
