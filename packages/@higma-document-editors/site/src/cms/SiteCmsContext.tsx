/**
 * @file CMS workspace context — thin wrapper around the site-cms-state reducer.
 *
 * Every UI surface dispatches through `useReducer` here. Mutation logic lives in
 * `site-cms-state.ts`; this file only wires React hooks, exposes selectors as
 * derived memos, and bridges to the SiteEditor workspace SoT.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { useSiteEditor } from "../context/SiteEditorContext";
import {
  extractSiteCollections,
  type SiteCollection,
  type SiteCollectionItem,
} from "../domain/site-collections";
import {
  INITIAL_SITE_CMS_STATE,
  assertCollectionExists,
  assertItemExists,
  isSiteCmsDraftId,
  makeAutoCollectionDisplayName,
  makeAutoFieldDisplayName,
  makeNextDraftCollectionId,
  makeNextDraftFieldId,
  makeNextDraftItemId,
  resolveRelativeItemId,
  selectActiveSiteCmsCollection,
  selectActiveSiteCmsItem,
  selectFieldEdits,
  selectSiteCmsCollections,
  siteCmsReducer,
  type SiteCmsAction,
  type SiteCmsAddFieldRequest,
  type SiteCmsAddItemRequest,
  type SiteCmsCollectionRef,
  type SiteCmsCollectionRenameRequest,
  type SiteCmsDraftCollection,
  type SiteCmsDraftField,
  type SiteCmsDraftItem,
  type SiteCmsDrafts,
  type SiteCmsFieldEdit,
  type SiteCmsFieldKindRequest,
  type SiteCmsFieldRef,
  type SiteCmsFieldRenameRequest,
  type SiteCmsItemRef,
  type SiteCmsState,
} from "./site-cms-state";

export type SiteCmsContextValue = {
  readonly state: SiteCmsState;
  readonly dispatch: (action: SiteCmsAction) => void;
  readonly collections: readonly SiteCollection[];
  readonly activeCollection: SiteCollection | null;
  readonly activeItem: SiteCollectionItem | null;
  readonly fieldEdits: readonly SiteCmsFieldEdit[];
  readonly drafts: SiteCmsDrafts;
  // Navigation
  readonly setActiveCollectionId: (collectionId: string | null) => void;
  readonly setActiveItemId: (itemId: string | null) => void;
  readonly openItemRelative: (offset: 1 | -1) => void;
  readonly closeItem: () => void;
  // Field value editing
  readonly setFieldValue: (input: SiteCmsFieldEdit) => void;
  readonly resetFieldEdits: () => void;
  // Create
  readonly addDraftCollection: () => SiteCmsDraftCollection;
  readonly addDraftField: (input: SiteCmsAddFieldRequest) => SiteCmsDraftField;
  readonly addDraftItem: (input: SiteCmsAddItemRequest) => SiteCmsDraftItem;
  // Update (rename + retype)
  readonly renameCollection: (input: SiteCmsCollectionRenameRequest) => void;
  readonly renameField: (input: SiteCmsFieldRenameRequest) => void;
  readonly setFieldKind: (input: SiteCmsFieldKindRequest) => void;
  // Delete (drafts only)
  readonly deleteDraftCollection: (input: SiteCmsCollectionRef) => void;
  readonly deleteDraftField: (input: SiteCmsFieldRef) => void;
  readonly deleteDraftItem: (input: SiteCmsItemRef) => void;
};

const SiteCmsContext = createContext<SiteCmsContextValue | null>(null);

function pickInitialActiveCollectionId(collections: readonly SiteCollection[]): string | null {
  const first = collections[0];
  if (!first) {
    return null;
  }
  return first.id;
}

function buildInitialState(sourceCollections: readonly SiteCollection[]): SiteCmsState {
  const initialCollectionId = pickInitialActiveCollectionId(sourceCollections);
  if (initialCollectionId === null) {
    return INITIAL_SITE_CMS_STATE;
  }
  return { ...INITIAL_SITE_CMS_STATE, activeCollectionId: initialCollectionId };
}

function assertDraftId(id: string, label: string): void {
  if (!isSiteCmsDraftId(id)) {
    throw new Error(`${label} ${id} is not a draft entity and cannot be deleted via this action`);
  }
}

function assertSelectableItem(activeCollection: SiteCollection | null, itemId: string | null): void {
  if (itemId === null) {
    return;
  }
  if (!activeCollection) {
    throw new Error("Cannot select an item without an active collection");
  }
  assertItemExists(activeCollection, itemId);
}

export type SiteCmsProviderProps = {
  readonly children: ReactNode;
  readonly onFieldEditsChange?: (edits: readonly SiteCmsFieldEdit[]) => void;
};

/** Provide CMS workspace state via the pure reducer. */
export function SiteCmsProvider({ children, onFieldEditsChange }: SiteCmsProviderProps) {
  const { workspace } = useSiteEditor();
  const sourceCollections = useMemo(
    () => extractSiteCollections(workspace.session.document),
    [workspace],
  );

  const [state, dispatch] = useReducer(
    siteCmsReducer,
    sourceCollections,
    buildInitialState,
  );

  const collections = useMemo(
    () => selectSiteCmsCollections(state, sourceCollections),
    [state, sourceCollections],
  );
  const activeCollection = useMemo(
    () => selectActiveSiteCmsCollection(collections, state.activeCollectionId),
    [collections, state.activeCollectionId],
  );
  const activeItem = useMemo(
    () => selectActiveSiteCmsItem(activeCollection, state.activeItemId),
    [activeCollection, state.activeItemId],
  );
  const fieldEdits = useMemo(() => selectFieldEdits(state), [state]);

  useEffect(() => {
    if (onFieldEditsChange) {
      onFieldEditsChange(fieldEdits);
    }
  }, [fieldEdits, onFieldEditsChange]);

  const setActiveCollectionId = useCallback((collectionId: string | null) => {
    if (collectionId !== null) {
      assertCollectionExists(collections, collectionId);
    }
    dispatch({ type: "set-active-collection", collectionId });
  }, [collections]);

  const setActiveItemId = useCallback((itemId: string | null) => {
    assertSelectableItem(activeCollection, itemId);
    dispatch({ type: "set-active-item", itemId });
  }, [activeCollection]);

  const openItemRelative = useCallback((offset: 1 | -1) => {
    if (!activeCollection || state.activeItemId === null) {
      return;
    }
    const nextId = resolveRelativeItemId(activeCollection, state.activeItemId, offset);
    if (nextId === null) {
      return;
    }
    dispatch({ type: "set-active-item", itemId: nextId });
  }, [activeCollection, state.activeItemId]);

  const closeItem = useCallback(() => {
    dispatch({ type: "set-active-item", itemId: null });
  }, []);

  const setFieldValue = useCallback((input: SiteCmsFieldEdit) => {
    dispatch({ type: "set-field-value", edit: input });
  }, []);

  const resetFieldEdits = useCallback(() => {
    dispatch({ type: "reset-field-edits" });
  }, []);

  const addDraftCollection = useCallback(() => {
    const id = makeNextDraftCollectionId(sourceCollections, state.drafts);
    const displayName = makeAutoCollectionDisplayName(sourceCollections, state.drafts);
    const collection: SiteCmsDraftCollection = { id, displayName };
    dispatch({ type: "add-draft-collection", collection, setActive: true });
    return collection;
  }, [sourceCollections, state.drafts]);

  const addDraftField = useCallback(
    (input: SiteCmsAddFieldRequest) => {
      const collection = collections.find((entry) => entry.id === input.collectionId);
      if (!collection) {
        throw new Error(`Cannot add field: collection ${input.collectionId} not found`);
      }
      const id = makeNextDraftFieldId(sourceCollections, state.drafts);
      const displayName = makeAutoFieldDisplayName(collection, state.drafts, input.kind);
      const field: SiteCmsDraftField = {
        id,
        collectionId: input.collectionId,
        displayName,
        kind: input.kind,
      };
      dispatch({ type: "add-draft-field", field });
      return field;
    },
    [collections, sourceCollections, state.drafts],
  );

  const addDraftItem = useCallback(
    (input: SiteCmsAddItemRequest) => {
      assertCollectionExists(collections, input.collectionId);
      const id = makeNextDraftItemId(sourceCollections, state.drafts);
      const item: SiteCmsDraftItem = { id, collectionId: input.collectionId };
      dispatch({ type: "add-draft-item", item, setActive: true });
      return item;
    },
    [collections, sourceCollections, state.drafts],
  );

  const renameCollection = useCallback(
    (input: SiteCmsCollectionRenameRequest) => {
      assertCollectionExists(collections, input.collectionId);
      dispatch({ type: "set-collection-display-name", collectionId: input.collectionId, displayName: input.displayName });
    },
    [collections],
  );

  const renameField = useCallback(
    (input: SiteCmsFieldRenameRequest) => {
      const collection = collections.find((entry) => entry.id === input.collectionId);
      if (!collection) {
        throw new Error(`Cannot rename field: collection ${input.collectionId} not found`);
      }
      const field = collection.fields.find((entry) => entry.id === input.fieldId);
      if (!field) {
        throw new Error(`Cannot rename field: field ${input.fieldId} not found`);
      }
      dispatch({ type: "set-field-display-name", collectionId: input.collectionId, fieldId: input.fieldId, displayName: input.displayName });
    },
    [collections],
  );

  const setFieldKind = useCallback(
    (input: SiteCmsFieldKindRequest) => {
      const collection = collections.find((entry) => entry.id === input.collectionId);
      if (!collection) {
        throw new Error(`Cannot retype field: collection ${input.collectionId} not found`);
      }
      const field = collection.fields.find((entry) => entry.id === input.fieldId);
      if (!field) {
        throw new Error(`Cannot retype field: field ${input.fieldId} not found`);
      }
      dispatch({ type: "set-field-kind", collectionId: input.collectionId, fieldId: input.fieldId, kind: input.kind });
    },
    [collections],
  );

  const deleteDraftCollection = useCallback(
    (input: SiteCmsCollectionRef) => {
      assertDraftId(input.collectionId, "Collection");
      dispatch({ type: "delete-draft-collection", collectionId: input.collectionId });
    },
    [],
  );

  const deleteDraftField = useCallback(
    (input: SiteCmsFieldRef) => {
      assertDraftId(input.fieldId, "Field");
      dispatch({ type: "delete-draft-field", collectionId: input.collectionId, fieldId: input.fieldId });
    },
    [],
  );

  const deleteDraftItem = useCallback(
    (input: SiteCmsItemRef) => {
      assertDraftId(input.itemId, "Item");
      dispatch({ type: "delete-draft-item", collectionId: input.collectionId, itemId: input.itemId });
    },
    [],
  );

  const value = useMemo<SiteCmsContextValue>(
    () => ({
      state,
      dispatch,
      collections,
      activeCollection,
      activeItem,
      fieldEdits,
      drafts: state.drafts,
      setActiveCollectionId,
      setActiveItemId,
      openItemRelative,
      closeItem,
      setFieldValue,
      resetFieldEdits,
      addDraftCollection,
      addDraftField,
      addDraftItem,
      renameCollection,
      renameField,
      setFieldKind,
      deleteDraftCollection,
      deleteDraftField,
      deleteDraftItem,
    }),
    [
      state,
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
      addDraftCollection,
      addDraftField,
      addDraftItem,
      renameCollection,
      renameField,
      setFieldKind,
      deleteDraftCollection,
      deleteDraftField,
      deleteDraftItem,
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
