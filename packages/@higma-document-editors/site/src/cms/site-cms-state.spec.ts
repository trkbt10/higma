/**
 * @file Reducer + selector tests for the CMS workspace state.
 */

import { extractSiteCollections } from "../domain/site-collections";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import {
  INITIAL_SITE_CMS_STATE,
  fieldEditKey,
  makeAutoCollectionDisplayName,
  makeAutoFieldDisplayName,
  makeNextDraftCollectionId,
  makeNextDraftFieldId,
  makeNextDraftItemId,
  resolveRelativeItemId,
  selectActiveSiteCmsCollection,
  selectActiveSiteCmsItem,
  selectCollectionDisplayName,
  selectFieldDisplayName,
  selectFieldEdits,
  selectSiteCmsCollections,
  siteCmsReducer,
  type SiteCmsState,
} from "./site-cms-state";

const document = createSiteEditorTestDocument();
const sourceCollections = extractSiteCollections(document);

describe("siteCmsReducer", () => {
  it("set-active-collection updates the slice and clears the active item", () => {
    const intermediate = siteCmsReducer(INITIAL_SITE_CMS_STATE, { type: "set-active-item", itemId: "" });
    const next = siteCmsReducer(intermediate, { type: "set-active-collection", collectionId: "collection-1" });
    expect(next.activeCollectionId).toBe("collection-1");
    expect(next.activeItemId).toBeNull();
  });

  it("set-field-value writes to the editsMap by composite key", () => {
    const next = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "set-field-value",
      edit: { collectionId: "c", itemId: "", fieldId: "body", text: "hello" },
    });
    expect(next.editsMap.get(fieldEditKey({ collectionId: "c", itemId: "", fieldId: "body" }))).toBe("hello");
    expect(INITIAL_SITE_CMS_STATE.editsMap.size).toBe(0);
  });

  it("reset-field-edits empties the editsMap", () => {
    const a = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "set-field-value",
      edit: { collectionId: "c", itemId: "", fieldId: "body", text: "x" },
    });
    const b = siteCmsReducer(a, { type: "reset-field-edits" });
    expect(b.editsMap.size).toBe(0);
  });

  it("add-draft-collection appends and (optionally) selects the new draft", () => {
    const next = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "add-draft-collection",
      collection: { id: "draft-collection-1", displayName: "Pages" },
      setActive: true,
    });
    expect(next.drafts.collections).toHaveLength(1);
    expect(next.activeCollectionId).toBe("draft-collection-1");
  });

  it("add-draft-item appends and (optionally) opens the editor on it", () => {
    const next = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "add-draft-item",
      item: { id: "draft-item-1", collectionId: "collection-1" },
      setActive: true,
    });
    expect(next.drafts.items).toHaveLength(1);
    expect(next.activeItemId).toBe("draft-item-1");
  });
});

describe("selectors", () => {
  it("selectSiteCmsCollections merges drafts and edits over sourceCollections", () => {
    const stateWithDraftItem: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      drafts: {
        collections: [],
        fields: [],
        items: [{ id: "draft-item-1", collectionId: "collection-1" }],
      },
      editsMap: new Map([
        [fieldEditKey({ collectionId: "collection-1", itemId: "draft-item-1", fieldId: "body" }), "fresh body"],
      ]),
    };

    const collections = selectSiteCmsCollections(stateWithDraftItem, sourceCollections);
    const collection = collections[0];
    if (!collection) {
      throw new Error("Expected at least one collection");
    }
    expect(collection.items.map((item) => item.id)).toEqual(["", "draft-item-1"]);
    const draftValue = collection.items[1]?.values[0];
    expect(draftValue?.text).toBe("fresh body");
  });

  it("resolveRelativeItemId clamps at the boundaries", () => {
    const stateWithTwoItems: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      drafts: {
        collections: [],
        fields: [],
        items: [{ id: "draft-item-1", collectionId: "collection-1" }],
      },
    };
    const collections = selectSiteCmsCollections(stateWithTwoItems, sourceCollections);
    const collection = selectActiveSiteCmsCollection(collections, "collection-1");
    if (!collection) {
      throw new Error("collection-1 missing");
    }
    expect(resolveRelativeItemId(collection, "", 1)).toBe("draft-item-1");
    expect(resolveRelativeItemId(collection, "", -1)).toBeNull();
    expect(resolveRelativeItemId(collection, "draft-item-1", 1)).toBeNull();
    expect(selectActiveSiteCmsItem(collection, "draft-item-1")?.id).toBe("draft-item-1");
  });

  it("selectFieldEdits expands the editsMap into the public payload shape", () => {
    const state: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      editsMap: new Map([
        [fieldEditKey({ collectionId: "c", itemId: "", fieldId: "f" }), "v"],
      ]),
    };
    expect(selectFieldEdits(state)).toEqual([{ collectionId: "c", itemId: "", fieldId: "f", text: "v" }]);
  });
});

describe("draft id allocators", () => {
  it("avoid colliding with existing source ids and previously generated drafts", () => {
    const drafts = INITIAL_SITE_CMS_STATE.drafts;
    expect(makeNextDraftCollectionId(sourceCollections, drafts)).toBe("draft-collection-1");
    expect(makeNextDraftFieldId(sourceCollections, drafts)).toBe("draft-field-1");
    expect(makeNextDraftItemId(sourceCollections, drafts)).toBe("draft-item-1");

    const newDrafts = {
      collections: [{ id: "draft-collection-1", displayName: "x" }],
      fields: [],
      items: [],
    };
    expect(makeNextDraftCollectionId(sourceCollections, newDrafts)).toBe("draft-collection-2");
  });

  it("auto-names new collections by total count", () => {
    expect(makeAutoCollectionDisplayName(sourceCollections, INITIAL_SITE_CMS_STATE.drafts)).toBe("Collection 2");
  });

  it("auto-names new fields by collection-local count and kind", () => {
    const collection = sourceCollections[0];
    if (!collection) {
      throw new Error("Expected at least one collection");
    }
    expect(makeAutoFieldDisplayName(collection, INITIAL_SITE_CMS_STATE.drafts, "text")).toBe("Text 2");
    expect(makeAutoFieldDisplayName(collection, INITIAL_SITE_CMS_STATE.drafts, "rich-text")).toBe("Rich Text 2");
  });
});

describe("CRUD reducer actions", () => {
  it("delete-draft-collection cascades drafts, edits, overrides, and active selection", () => {
    const seeded: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      activeCollectionId: "draft-collection-1",
      activeItemId: "draft-item-1",
      drafts: {
        collections: [{ id: "draft-collection-1", displayName: "Pages" }],
        fields: [{ id: "draft-field-1", collectionId: "draft-collection-1", displayName: "Title", kind: "text" }],
        items: [{ id: "draft-item-1", collectionId: "draft-collection-1" }],
      },
      editsMap: new Map([
        [fieldEditKey({ collectionId: "draft-collection-1", itemId: "draft-item-1", fieldId: "draft-field-1" }), "Hello"],
      ]),
      collectionDisplayNames: new Map([["draft-collection-1", "Pages renamed"]]),
      fieldDisplayNames: new Map([["draft-collection-1/draft-field-1", "Title renamed"]]),
    };

    const next = siteCmsReducer(seeded, { type: "delete-draft-collection", collectionId: "draft-collection-1" });

    expect(next.drafts.collections).toHaveLength(0);
    expect(next.drafts.fields).toHaveLength(0);
    expect(next.drafts.items).toHaveLength(0);
    expect(next.editsMap.size).toBe(0);
    expect(next.collectionDisplayNames.size).toBe(0);
    expect(next.fieldDisplayNames.size).toBe(0);
    expect(next.activeCollectionId).toBeNull();
    expect(next.activeItemId).toBeNull();
  });

  it("delete-draft-field cascades drafts, edits, and overrides for that field only", () => {
    const seeded: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      drafts: {
        collections: [],
        fields: [
          { id: "draft-field-1", collectionId: "collection-1", displayName: "Title", kind: "text" },
          { id: "draft-field-2", collectionId: "collection-1", displayName: "Body", kind: "rich-text" },
        ],
        items: [],
      },
      editsMap: new Map([
        [fieldEditKey({ collectionId: "collection-1", itemId: "", fieldId: "draft-field-1" }), "x"],
        [fieldEditKey({ collectionId: "collection-1", itemId: "", fieldId: "draft-field-2" }), "y"],
      ]),
      fieldDisplayNames: new Map([
        ["collection-1/draft-field-1", "Title renamed"],
        ["collection-1/draft-field-2", "Body renamed"],
      ]),
    };

    const next = siteCmsReducer(seeded, { type: "delete-draft-field", collectionId: "collection-1", fieldId: "draft-field-1" });

    expect(next.drafts.fields.map((field) => field.id)).toEqual(["draft-field-2"]);
    expect(next.editsMap.size).toBe(1);
    expect(next.editsMap.get(fieldEditKey({ collectionId: "collection-1", itemId: "", fieldId: "draft-field-2" }))).toBe("y");
    expect(next.fieldDisplayNames.get("collection-1/draft-field-2")).toBe("Body renamed");
    expect(next.fieldDisplayNames.has("collection-1/draft-field-1")).toBe(false);
  });

  it("delete-draft-item drops the draft, its edits, and clears active selection if pointed there", () => {
    const seeded: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      activeItemId: "draft-item-1",
      drafts: {
        collections: [],
        fields: [],
        items: [{ id: "draft-item-1", collectionId: "collection-1" }],
      },
      editsMap: new Map([
        [fieldEditKey({ collectionId: "collection-1", itemId: "draft-item-1", fieldId: "body" }), "x"],
      ]),
    };

    const next = siteCmsReducer(seeded, { type: "delete-draft-item", collectionId: "collection-1", itemId: "draft-item-1" });

    expect(next.drafts.items).toHaveLength(0);
    expect(next.editsMap.size).toBe(0);
    expect(next.activeItemId).toBeNull();
  });

  it("set-collection-display-name and set-field-display-name register overrides", () => {
    const a = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "set-collection-display-name",
      collectionId: "collection-1",
      displayName: "Case Studies",
    });
    expect(selectCollectionDisplayName(a, "collection-1")).toBe("Case Studies");

    const b = siteCmsReducer(a, {
      type: "set-field-display-name",
      collectionId: "collection-1",
      fieldId: "body",
      displayName: "Body content",
    });
    expect(selectFieldDisplayName(b, "collection-1", "body")).toBe("Body content");
  });

  it("set-field-kind overrides the kind reported by selectSiteCmsCollections for a source field", () => {
    const next = siteCmsReducer(INITIAL_SITE_CMS_STATE, {
      type: "set-field-kind",
      collectionId: "collection-1",
      fieldId: "body",
      kind: "text",
    });
    const collections = selectSiteCmsCollections(next, sourceCollections);
    const collection = collections[0];
    if (!collection) {
      throw new Error("Expected at least one collection");
    }
    const overridden = collection.fields.find((field) => field.id === "body");
    if (!overridden) {
      throw new Error("Expected the body field to remain present");
    }
    expect(overridden.kind).toBe("text");
  });

  it("delete-draft-collection cascades fieldKindOverrides for that collection", () => {
    const seeded: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      drafts: {
        collections: [{ id: "draft-collection-1", displayName: "Pages" }],
        fields: [{ id: "draft-field-1", collectionId: "draft-collection-1", displayName: "Title", kind: "text" }],
        items: [],
      },
      fieldKindOverrides: new Map([
        ["draft-collection-1/draft-field-1", "rich-text"],
        ["collection-1/body", "text"],
      ]),
    };
    const next = siteCmsReducer(seeded, { type: "delete-draft-collection", collectionId: "draft-collection-1" });
    expect(next.fieldKindOverrides.has("draft-collection-1/draft-field-1")).toBe(false);
    expect(next.fieldKindOverrides.get("collection-1/body")).toBe("text");
  });

  it("delete-draft-field clears the kind override for that field only", () => {
    const seeded: SiteCmsState = {
      ...INITIAL_SITE_CMS_STATE,
      drafts: {
        collections: [],
        fields: [{ id: "draft-field-1", collectionId: "collection-1", displayName: "Title", kind: "text" }],
        items: [],
      },
      fieldKindOverrides: new Map([
        ["collection-1/draft-field-1", "rich-text"],
        ["collection-1/body", "text"],
      ]),
    };
    const next = siteCmsReducer(seeded, { type: "delete-draft-field", collectionId: "collection-1", fieldId: "draft-field-1" });
    expect(next.fieldKindOverrides.has("collection-1/draft-field-1")).toBe(false);
    expect(next.fieldKindOverrides.get("collection-1/body")).toBe("text");
  });
});
