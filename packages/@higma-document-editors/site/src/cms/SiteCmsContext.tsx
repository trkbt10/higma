/**
 * @file CMS workspace navigation + edit-state context.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useSiteEditor } from "../context/SiteEditorContext";
import {
  extractSiteCollections,
  findSiteCollection,
  findSiteCollectionItem,
  findSiteCollectionItemValue,
  type SiteCollection,
  type SiteCollectionField,
  type SiteCollectionItem,
  type SiteCollectionItemValue,
} from "../domain/site-collections";

export type SiteCmsFieldEditKey = string;

export type SiteCmsFieldEdit = {
  readonly collectionId: string;
  readonly itemId: string;
  readonly fieldId: string;
  readonly text: string;
};

export type SiteCmsContextValue = {
  readonly collections: readonly SiteCollection[];
  readonly activeCollection: SiteCollection | null;
  readonly activeItem: SiteCollectionItem | null;
  readonly fieldEdits: readonly SiteCmsFieldEdit[];
  readonly setActiveCollectionId: (collectionId: string | null) => void;
  readonly setActiveItemId: (itemId: string | null) => void;
  readonly openItemRelative: (offset: 1 | -1) => void;
  readonly closeItem: () => void;
  readonly setFieldValue: (input: SiteCmsFieldEdit) => void;
  readonly resetFieldEdits: () => void;
};

const SiteCmsContext = createContext<SiteCmsContextValue | null>(null);

function fieldEditKey(input: { readonly collectionId: string; readonly itemId: string; readonly fieldId: string }): SiteCmsFieldEditKey {
  return `${input.collectionId} ${input.itemId} ${input.fieldId}`;
}

function applyEditsToValue(
  collectionId: string,
  itemId: string,
  field: SiteCollectionField,
  base: SiteCollectionItemValue,
  edits: ReadonlyMap<SiteCmsFieldEditKey, string>,
): SiteCollectionItemValue {
  const editText = edits.get(fieldEditKey({ collectionId, itemId, fieldId: field.id }));
  if (editText === undefined) {
    return base;
  }
  return { ...base, text: editText };
}

function applyEditsToItem(
  collectionId: string,
  fields: readonly SiteCollectionField[],
  item: SiteCollectionItem,
  edits: ReadonlyMap<SiteCmsFieldEditKey, string>,
): SiteCollectionItem {
  const values = fields.map((field) => {
    const base = findSiteCollectionItemValue(item, field.id);
    return applyEditsToValue(collectionId, item.id, field, base, edits);
  });
  return { ...item, values };
}

function applyEditsToCollection(
  collection: SiteCollection,
  edits: ReadonlyMap<SiteCmsFieldEditKey, string>,
): SiteCollection {
  return {
    ...collection,
    items: collection.items.map((item) => applyEditsToItem(collection.id, collection.fields, item, edits)),
  };
}

function applyEditsToCollections(
  source: readonly SiteCollection[],
  edits: ReadonlyMap<SiteCmsFieldEditKey, string>,
): readonly SiteCollection[] {
  if (edits.size === 0) {
    return source;
  }
  return source.map((collection) => applyEditsToCollection(collection, edits));
}

function readEditsAsArray(edits: ReadonlyMap<SiteCmsFieldEditKey, string>): readonly SiteCmsFieldEdit[] {
  return [...edits.entries()].map(([key, text]) => {
    const [collectionId, itemId, fieldId] = key.split(" ");
    if (collectionId === undefined || itemId === undefined || fieldId === undefined) {
      throw new Error(`Invalid CMS field edit key: ${key}`);
    }
    return { collectionId, itemId, fieldId, text };
  });
}

function pickInitialCollectionId(collections: readonly SiteCollection[]): string | null {
  const first = collections[0];
  if (!first) {
    return null;
  }
  return first.id;
}

/** Provide CMS collections, navigation state, and editable field values. */
export function SiteCmsProvider({ children }: { readonly children: ReactNode }) {
  const { workspace } = useSiteEditor();
  const sourceCollections = useMemo(
    () => extractSiteCollections(workspace.session.document),
    [workspace],
  );

  const [editsMap, setEditsMap] = useState<ReadonlyMap<SiteCmsFieldEditKey, string>>(() => new Map());

  const collections = useMemo(
    () => applyEditsToCollections(sourceCollections, editsMap),
    [sourceCollections, editsMap],
  );

  const initialCollectionId = useMemo(() => pickInitialCollectionId(collections), [collections]);
  const [activeCollectionId, setActiveCollectionIdState] = useState<string | null>(initialCollectionId);
  const [activeItemId, setActiveItemIdState] = useState<string | null>(null);

  const activeCollection = useMemo(() => {
    if (!activeCollectionId) {
      return null;
    }
    return findSiteCollection(collections, activeCollectionId);
  }, [collections, activeCollectionId]);

  const activeItem = useMemo(() => {
    if (!activeCollection || activeItemId === null) {
      return null;
    }
    return findSiteCollectionItem(activeCollection, activeItemId);
  }, [activeCollection, activeItemId]);

  const setActiveCollectionId = useCallback((collectionId: string | null) => {
    if (collectionId !== null) {
      findSiteCollection(collections, collectionId);
    }
    setActiveCollectionIdState(collectionId);
    setActiveItemIdState(null);
  }, [collections]);

  const setActiveItemId = useCallback((itemId: string | null) => {
    if (itemId !== null) {
      if (!activeCollection) {
        throw new Error("Cannot select an item without an active collection");
      }
      findSiteCollectionItem(activeCollection, itemId);
    }
    setActiveItemIdState(itemId);
  }, [activeCollection]);

  const openItemRelative = useCallback((offset: 1 | -1) => {
    if (!activeCollection || activeItemId === null) {
      return;
    }
    const items = activeCollection.items;
    const currentIndex = items.findIndex((item) => item.id === activeItemId);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= items.length) {
      return;
    }
    const next = items[nextIndex];
    if (!next) {
      return;
    }
    setActiveItemIdState(next.id);
  }, [activeCollection, activeItemId]);

  const closeItem = useCallback(() => {
    setActiveItemIdState(null);
  }, []);

  const setFieldValue = useCallback((input: SiteCmsFieldEdit) => {
    setEditsMap((current) => {
      const next = new Map(current);
      next.set(fieldEditKey(input), input.text);
      return next;
    });
  }, []);

  const resetFieldEdits = useCallback(() => {
    setEditsMap(new Map());
  }, []);

  const fieldEdits = useMemo(() => readEditsAsArray(editsMap), [editsMap]);

  const value = useMemo<SiteCmsContextValue>(
    () => ({
      collections,
      activeCollection,
      activeItem,
      fieldEdits,
      setActiveCollectionId,
      setActiveItemId,
      openItemRelative,
      closeItem,
      setFieldValue,
      resetFieldEdits,
    }),
    [
      collections,
      activeCollection,
      activeItem,
      fieldEdits,
      setActiveCollectionId,
      setActiveItemId,
      openItemRelative,
      closeItem,
      setFieldValue,
      resetFieldEdits,
    ],
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
