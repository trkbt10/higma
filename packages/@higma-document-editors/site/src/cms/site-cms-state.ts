/**
 * @file Pure CMS workspace state, action union, reducer, and selectors.
 *
 * This module is the SoT for every CMS workspace mutation. The provider is a
 * thin wrapper around `useReducer(siteCmsReducer, INITIAL_SITE_CMS_STATE)`;
 * every UI surface dispatches one of the actions declared here. No `useState`
 * slices are exposed — the reducer is the single mutation point.
 */

import {
  findSiteCollection,
  findSiteCollectionItem,
  findSiteCollectionItemValue,
  type SiteCollection,
  type SiteCollectionField,
  type SiteCollectionItem,
  type SiteCollectionItemValue,
} from "../domain/site-collections";
import {
  getSiteCollectionFieldKindLabel,
  type SiteCollectionFieldKind,
} from "../domain/site-collection-field-kind";

// ===========================================================================
// Domain value types
// ===========================================================================

export type SiteCmsFieldEditKey = string;

export type SiteCmsFieldEdit = {
  readonly collectionId: string;
  readonly itemId: string;
  readonly fieldId: string;
  readonly text: string;
};

export type SiteCmsDraftCollection = {
  readonly id: string;
  readonly displayName: string;
};

export type SiteCmsDraftField = {
  readonly id: string;
  readonly collectionId: string;
  readonly displayName: string;
  readonly kind: SiteCollectionFieldKind;
};

export type SiteCmsDraftItem = {
  readonly id: string;
  readonly collectionId: string;
};

export type SiteCmsDrafts = {
  readonly collections: readonly SiteCmsDraftCollection[];
  readonly fields: readonly SiteCmsDraftField[];
  readonly items: readonly SiteCmsDraftItem[];
};

// ===========================================================================
// Reducer state + actions
// ===========================================================================

export type SiteCmsState = {
  readonly drafts: SiteCmsDrafts;
  readonly editsMap: ReadonlyMap<SiteCmsFieldEditKey, string>;
  /** Collection id → user-set display name override. */
  readonly collectionDisplayNames: ReadonlyMap<string, string>;
  /** `${collectionId}/${fieldId}` → user-set display name override. */
  readonly fieldDisplayNames: ReadonlyMap<string, string>;
  readonly activeCollectionId: string | null;
  readonly activeItemId: string | null;
};

export type SiteCmsAction =
  | { readonly type: "set-active-collection"; readonly collectionId: string | null }
  | { readonly type: "set-active-item"; readonly itemId: string | null }
  | { readonly type: "set-field-value"; readonly edit: SiteCmsFieldEdit }
  | { readonly type: "reset-field-edits" }
  | { readonly type: "add-draft-collection"; readonly collection: SiteCmsDraftCollection; readonly setActive: boolean }
  | { readonly type: "add-draft-field"; readonly field: SiteCmsDraftField }
  | { readonly type: "add-draft-item"; readonly item: SiteCmsDraftItem; readonly setActive: boolean }
  | { readonly type: "delete-draft-collection"; readonly collectionId: string }
  | { readonly type: "delete-draft-field"; readonly collectionId: string; readonly fieldId: string }
  | { readonly type: "delete-draft-item"; readonly collectionId: string; readonly itemId: string }
  | { readonly type: "set-collection-display-name"; readonly collectionId: string; readonly displayName: string }
  | { readonly type: "set-field-display-name"; readonly collectionId: string; readonly fieldId: string; readonly displayName: string };

export const INITIAL_SITE_CMS_STATE: SiteCmsState = {
  drafts: { collections: [], fields: [], items: [] },
  editsMap: new Map(),
  collectionDisplayNames: new Map(),
  fieldDisplayNames: new Map(),
  activeCollectionId: null,
  activeItemId: null,
};

// ===========================================================================
// Reducer
// ===========================================================================

function fieldOverrideKey(collectionId: string, fieldId: string): string {
  return `${collectionId}/${fieldId}`;
}

function dropEditsByPredicate(
  edits: ReadonlyMap<SiteCmsFieldEditKey, string>,
  predicate: (edit: { collectionId: string; itemId: string; fieldId: string }) => boolean,
): ReadonlyMap<SiteCmsFieldEditKey, string> {
  const next = new Map(edits);
  for (const key of [...next.keys()]) {
    const [collectionId, itemId, fieldId] = key.split(" ");
    if (collectionId === undefined || itemId === undefined || fieldId === undefined) {
      continue;
    }
    if (predicate({ collectionId, itemId, fieldId })) {
      next.delete(key);
    }
  }
  return next;
}

/** Pure CMS workspace reducer — single mutation point for the workspace state. */
export function siteCmsReducer(state: SiteCmsState, action: SiteCmsAction): SiteCmsState {
  switch (action.type) {
    case "set-active-collection":
      return {
        ...state,
        activeCollectionId: action.collectionId,
        activeItemId: null,
      };
    case "set-active-item":
      return { ...state, activeItemId: action.itemId };
    case "set-field-value": {
      const next = new Map(state.editsMap);
      next.set(fieldEditKey(action.edit), action.edit.text);
      return { ...state, editsMap: next };
    }
    case "reset-field-edits":
      return { ...state, editsMap: new Map() };
    case "add-draft-collection":
      return {
        ...state,
        drafts: { ...state.drafts, collections: [...state.drafts.collections, action.collection] },
        activeCollectionId: action.setActive ? action.collection.id : state.activeCollectionId,
        activeItemId: action.setActive ? null : state.activeItemId,
      };
    case "add-draft-field":
      return {
        ...state,
        drafts: { ...state.drafts, fields: [...state.drafts.fields, action.field] },
      };
    case "add-draft-item":
      return {
        ...state,
        drafts: { ...state.drafts, items: [...state.drafts.items, action.item] },
        activeItemId: action.setActive ? action.item.id : state.activeItemId,
      };
    case "delete-draft-collection": {
      const drafts: SiteCmsDrafts = {
        collections: state.drafts.collections.filter((collection) => collection.id !== action.collectionId),
        fields: state.drafts.fields.filter((field) => field.collectionId !== action.collectionId),
        items: state.drafts.items.filter((item) => item.collectionId !== action.collectionId),
      };
      const editsMap = dropEditsByPredicate(state.editsMap, (edit) => edit.collectionId === action.collectionId);
      const collectionDisplayNames = new Map(state.collectionDisplayNames);
      collectionDisplayNames.delete(action.collectionId);
      const fieldDisplayNames = new Map(state.fieldDisplayNames);
      for (const key of [...fieldDisplayNames.keys()]) {
        if (key.startsWith(`${action.collectionId}/`)) {
          fieldDisplayNames.delete(key);
        }
      }
      const activeCollectionId = state.activeCollectionId === action.collectionId ? null : state.activeCollectionId;
      const activeItemId = activeCollectionId === null ? null : state.activeItemId;
      return {
        ...state,
        drafts,
        editsMap,
        collectionDisplayNames,
        fieldDisplayNames,
        activeCollectionId,
        activeItemId,
      };
    }
    case "delete-draft-field": {
      const drafts: SiteCmsDrafts = {
        ...state.drafts,
        fields: state.drafts.fields.filter(
          (field) => !(field.collectionId === action.collectionId && field.id === action.fieldId),
        ),
      };
      const editsMap = dropEditsByPredicate(state.editsMap, (edit) =>
        edit.collectionId === action.collectionId && edit.fieldId === action.fieldId,
      );
      const fieldDisplayNames = new Map(state.fieldDisplayNames);
      fieldDisplayNames.delete(fieldOverrideKey(action.collectionId, action.fieldId));
      return {
        ...state,
        drafts,
        editsMap,
        fieldDisplayNames,
      };
    }
    case "delete-draft-item": {
      const drafts: SiteCmsDrafts = {
        ...state.drafts,
        items: state.drafts.items.filter(
          (item) => !(item.collectionId === action.collectionId && item.id === action.itemId),
        ),
      };
      const editsMap = dropEditsByPredicate(state.editsMap, (edit) =>
        edit.collectionId === action.collectionId && edit.itemId === action.itemId,
      );
      const activeItemId = state.activeItemId === action.itemId ? null : state.activeItemId;
      return {
        ...state,
        drafts,
        editsMap,
        activeItemId,
      };
    }
    case "set-collection-display-name": {
      const collectionDisplayNames = new Map(state.collectionDisplayNames);
      collectionDisplayNames.set(action.collectionId, action.displayName);
      return { ...state, collectionDisplayNames };
    }
    case "set-field-display-name": {
      const fieldDisplayNames = new Map(state.fieldDisplayNames);
      fieldDisplayNames.set(fieldOverrideKey(action.collectionId, action.fieldId), action.displayName);
      return { ...state, fieldDisplayNames };
    }
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

const DRAFT_COLLECTION_PREFIX = "draft-collection-";
const DRAFT_FIELD_PREFIX = "draft-field-";
const DRAFT_ITEM_PREFIX = "draft-item-";

/** Compose the storage key used by the editsMap. */
export function fieldEditKey(input: { readonly collectionId: string; readonly itemId: string; readonly fieldId: string }): SiteCmsFieldEditKey {
  return `${input.collectionId} ${input.itemId} ${input.fieldId}`;
}

function pickAvailableCounter(used: ReadonlySet<string>, candidate: number): number {
  if (!used.has(String(candidate))) {
    return candidate;
  }
  return pickAvailableCounter(used, candidate + 1);
}

function nextDraftId(prefix: string, existingIds: readonly string[]): string {
  const used = new Set(
    existingIds.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)),
  );
  return `${prefix}${pickAvailableCounter(used, 1)}`;
}

/** Detect a draft entity id, used by UI badges. */
export function isSiteCmsDraftId(id: string): boolean {
  return (
    id.startsWith(DRAFT_COLLECTION_PREFIX) ||
    id.startsWith(DRAFT_FIELD_PREFIX) ||
    id.startsWith(DRAFT_ITEM_PREFIX)
  );
}

// ===========================================================================
// Pure draft id allocators (used by action creators outside the reducer)
// ===========================================================================

/** Compute the next available draft collection id given current source + drafts. */
export function makeNextDraftCollectionId(
  sourceCollections: readonly SiteCollection[],
  drafts: SiteCmsDrafts,
): string {
  return nextDraftId(
    DRAFT_COLLECTION_PREFIX,
    [...sourceCollections.map((collection) => collection.id), ...drafts.collections.map((collection) => collection.id)],
  );
}

/** Compute the next available draft field id given current source + drafts. */
export function makeNextDraftFieldId(
  sourceCollections: readonly SiteCollection[],
  drafts: SiteCmsDrafts,
): string {
  const sourceFieldIds = sourceCollections.flatMap((collection) => collection.fields.map((field) => field.id));
  const draftFieldIds = drafts.fields.map((field) => field.id);
  return nextDraftId(DRAFT_FIELD_PREFIX, [...sourceFieldIds, ...draftFieldIds]);
}

/** Compute the next available draft item id given current source + drafts. */
export function makeNextDraftItemId(
  sourceCollections: readonly SiteCollection[],
  drafts: SiteCmsDrafts,
): string {
  const sourceItemIds = sourceCollections.flatMap((collection) => collection.items.map((item) => item.id));
  const draftItemIds = drafts.items.map((item) => item.id);
  return nextDraftId(DRAFT_ITEM_PREFIX, [...sourceItemIds, ...draftItemIds]);
}

/** Auto-generate the default display name for a new draft collection. */
export function makeAutoCollectionDisplayName(
  sourceCollections: readonly SiteCollection[],
  drafts: SiteCmsDrafts,
): string {
  const total = sourceCollections.length + drafts.collections.length + 1;
  return `Collection ${total}`;
}

/** Auto-generate the default display name for a new draft field. */
export function makeAutoFieldDisplayName(
  collection: SiteCollection,
  drafts: SiteCmsDrafts,
  kind: SiteCollectionFieldKind,
): string {
  const draftFieldsInCollection = drafts.fields.filter((field) => field.collectionId === collection.id);
  const total = collection.fields.length + draftFieldsInCollection.length + 1;
  return `${getSiteCollectionFieldKindLabel(kind)} ${total}`;
}

// ===========================================================================
// Selectors
// ===========================================================================

function buildEmptyValue(fieldId: string): SiteCollectionItemValue {
  return { fieldId, text: null, references: [] };
}

function mergeFields(
  source: readonly SiteCollectionField[],
  drafts: readonly SiteCmsDraftField[],
): readonly SiteCollectionField[] {
  if (drafts.length === 0) {
    return source;
  }
  const draftFields: SiteCollectionField[] = drafts.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    variableFields: [],
    references: [],
  }));
  return [...source, ...draftFields];
}

function mergeItems(
  source: readonly SiteCollectionItem[],
  fields: readonly SiteCollectionField[],
  drafts: readonly SiteCmsDraftItem[],
): readonly SiteCollectionItem[] {
  const reshaped: SiteCollectionItem[] = source.map((item) => ({
    ...item,
    values: fields.map((field) => {
      const match = item.values.find((value) => value.fieldId === field.id);
      if (match) {
        return match;
      }
      return buildEmptyValue(field.id);
    }),
  }));
  if (drafts.length === 0) {
    return reshaped;
  }
  const draftItems: SiteCollectionItem[] = drafts.map((draft) => ({
    id: draft.id,
    values: fields.map((field) => buildEmptyValue(field.id)),
  }));
  return [...reshaped, ...draftItems];
}

function mergeCollection(
  collection: SiteCollection,
  drafts: SiteCmsDrafts,
): SiteCollection {
  const collectionFields = drafts.fields.filter((field) => field.collectionId === collection.id);
  const collectionItems = drafts.items.filter((item) => item.collectionId === collection.id);
  const mergedFields = mergeFields(collection.fields, collectionFields);
  const mergedItems = mergeItems(collection.items, mergedFields, collectionItems);
  return { ...collection, fields: mergedFields, items: mergedItems };
}

function appendDraftCollections(
  base: readonly SiteCollection[],
  drafts: SiteCmsDrafts,
): readonly SiteCollection[] {
  if (drafts.collections.length === 0) {
    return base;
  }
  const draftCollections: SiteCollection[] = drafts.collections.map((draft) => {
    const fields: readonly SiteCollectionField[] = drafts.fields
      .filter((field) => field.collectionId === draft.id)
      .map((field) => ({
        id: field.id,
        kind: field.kind,
        variableFields: [],
        references: [],
      }));
    const items: readonly SiteCollectionItem[] = drafts.items
      .filter((item) => item.collectionId === draft.id)
      .map((item) => ({
        id: item.id,
        values: fields.map((field) => buildEmptyValue(field.id)),
      }));
    return { id: draft.id, fields, items, selectors: [] };
  });
  return [...base, ...draftCollections];
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

/** Pure selector: merge drafts and edits over sourceCollections to derive the visible Collections. */
export function selectSiteCmsCollections(
  state: SiteCmsState,
  sourceCollections: readonly SiteCollection[],
): readonly SiteCollection[] {
  const withDrafts = appendDraftCollections(
    sourceCollections.map((collection) => mergeCollection(collection, state.drafts)),
    state.drafts,
  );
  if (state.editsMap.size === 0) {
    return withDrafts;
  }
  return withDrafts.map((collection) => applyEditsToCollection(collection, state.editsMap));
}

/** Pure selector: pick the active collection or null when none selected. */
export function selectActiveSiteCmsCollection(
  collections: readonly SiteCollection[],
  activeCollectionId: string | null,
): SiteCollection | null {
  if (activeCollectionId === null) {
    return null;
  }
  return collections.find((collection) => collection.id === activeCollectionId) ?? null;
}

/** Pure selector: pick the active item from an active collection. */
export function selectActiveSiteCmsItem(
  collection: SiteCollection | null,
  activeItemId: string | null,
): SiteCollectionItem | null {
  if (collection === null || activeItemId === null) {
    return null;
  }
  return collection.items.find((item) => item.id === activeItemId) ?? null;
}

/** Resolve the next/previous item id for the up/down navigator. */
export function resolveRelativeItemId(
  collection: SiteCollection,
  currentItemId: string,
  offset: 1 | -1,
): string | null {
  const currentIndex = collection.items.findIndex((item) => item.id === currentItemId);
  if (currentIndex < 0) {
    return null;
  }
  const nextIndex = currentIndex + offset;
  const next = collection.items[nextIndex];
  if (!next) {
    return null;
  }
  return next.id;
}

/** Convert the editsMap slice into the array shape consumers see. */
export function selectFieldEdits(state: SiteCmsState): readonly SiteCmsFieldEdit[] {
  return [...state.editsMap.entries()].map(([key, text]) => {
    const [collectionId, itemId, fieldId] = key.split(" ");
    if (collectionId === undefined || itemId === undefined || fieldId === undefined) {
      throw new Error(`Invalid CMS field edit key: ${key}`);
    }
    return { collectionId, itemId, fieldId, text };
  });
}

/** Validate that a collection exists in the visible set; throws if not. */
export function assertCollectionExists(
  collections: readonly SiteCollection[],
  collectionId: string,
): void {
  findSiteCollection(collections, collectionId);
}

/** Validate that an item exists in the active collection; throws if not. */
export function assertItemExists(
  collection: SiteCollection,
  itemId: string,
): void {
  findSiteCollectionItem(collection, itemId);
}

/** Pick the current display name for a collection (override > draft default > none). */
export function selectCollectionDisplayName(
  state: SiteCmsState,
  collectionId: string,
): string | null {
  const override = state.collectionDisplayNames.get(collectionId);
  if (override !== undefined) {
    return override;
  }
  const draft = state.drafts.collections.find((entry) => entry.id === collectionId);
  if (draft) {
    return draft.displayName;
  }
  return null;
}

/** Pick the current display name for a field (override > draft default > none). */
export function selectFieldDisplayName(
  state: SiteCmsState,
  collectionId: string,
  fieldId: string,
): string | null {
  const override = state.fieldDisplayNames.get(fieldOverrideKey(collectionId, fieldId));
  if (override !== undefined) {
    return override;
  }
  const draft = state.drafts.fields.find(
    (entry) => entry.collectionId === collectionId && entry.id === fieldId,
  );
  if (draft) {
    return draft.displayName;
  }
  return null;
}
