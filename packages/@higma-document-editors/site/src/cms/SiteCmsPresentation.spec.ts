/**
 * @file UI display-name helper tests.
 */

import { extractSiteCollections, findSiteCollection, findSiteCollectionItem } from "../domain/site-collections";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import {
  getSiteCollectionDisplayName,
  getSiteCollectionFieldDisplayName,
  getSiteCollectionItemDisplayName,
} from "./SiteCmsPresentation";

describe("getSiteCollectionDisplayName", () => {
  it("uses the most descriptive selector node name when available", () => {
    const document = createSiteEditorTestDocument();
    const collection = findSiteCollection(extractSiteCollections(document), "collection-1");

    expect(getSiteCollectionDisplayName(collection, 0)).toBe("Case Study Page");
  });
});

describe("getSiteCollectionFieldDisplayName", () => {
  it("composes the kind label with the field's positional index", () => {
    const document = createSiteEditorTestDocument();
    const collection = findSiteCollection(extractSiteCollections(document), "collection-1");
    const field = collection.fields[0];
    if (!field) {
      throw new Error("Expected at least one field");
    }

    expect(getSiteCollectionFieldDisplayName(field, 0)).toBe("Rich Text 1");
  });
});

describe("getSiteCollectionItemDisplayName", () => {
  it("falls back to the placeholder when no text values are present", () => {
    const document = createSiteEditorTestDocument();
    const collection = findSiteCollection(extractSiteCollections(document), "collection-1");
    const item = findSiteCollectionItem(collection, "");

    expect(getSiteCollectionItemDisplayName(item)).toBe("Untitled item");
  });
});
