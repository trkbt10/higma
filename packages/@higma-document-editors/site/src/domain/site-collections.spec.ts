/**
 * @file CMS Collection domain extraction tests.
 */

import {
  extractSiteCollections,
  findSiteCollection,
  findSiteCollectionField,
  findSiteCollectionItem,
  findSiteCollectionItemValue,
} from "./site-collections";
import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";

describe("extractSiteCollections", () => {
  it("aggregates rich-text alias bindings and selectors into a single collection", () => {
    const document = createSiteEditorTestDocument();

    const collections = extractSiteCollections(document);

    expect(collections.length).toBe(1);
    const collection = collections[0];
    if (!collection) {
      throw new Error("Expected at least one collection");
    }
    expect(collection.id).toBe("collection-1");
    expect(collection.fields.map((field) => field.id)).toEqual(["body"]);
    expect(collection.fields[0]?.kind).toBe("rich-text");
    expect(collection.fields[0]?.references.map((reference) => reference.nodeName).sort())
      .toEqual(["Body", "Mobile Body", "Tablet Body"]);
    expect(collection.items.map((item) => item.id)).toEqual([""]);
    expect(collection.items[0]?.values.map((value) => value.fieldId)).toEqual(["body"]);
  });

  it("captures the responsive-set selector with its filter and limit", () => {
    const document = createSiteEditorTestDocument();
    const collection = findSiteCollection(extractSiteCollections(document), "collection-1");

    const responsiveSelector = collection.selectors.find((selector) => selector.nodeType === "RESPONSIVE_SET");
    if (!responsiveSelector) {
      throw new Error("Expected a responsive-set selector for the case study");
    }
    expect(responsiveSelector.matchType).toBe("MATCH_ALL");
    expect(responsiveSelector.limit).toBe(1);
    expect(responsiveSelector.filters).toEqual([{ fieldId: "slug", operator: "EQUALS", comparisonValue: "case-study" }]);

    const repeaterSelectors = collection.selectors.filter((selector) => selector.nodeType === "REPEATER");
    expect(repeaterSelectors.length).toBe(3);
    for (const selector of repeaterSelectors) {
      expect(selector.limit).toBe(0);
      expect(selector.filters).toEqual([]);
    }
  });

  it("throws explicit errors when missing entities are requested", () => {
    const document = createSiteEditorTestDocument();
    const collections = extractSiteCollections(document);

    expect(() => findSiteCollection(collections, "missing")).toThrow(/Site collection missing/);
    const collection = findSiteCollection(collections, "collection-1");
    expect(() => findSiteCollectionField(collection, "missing")).toThrow(/Field missing/);
    expect(() => findSiteCollectionItem(collection, "missing")).toThrow(/Item missing/);
    expect(() => findSiteCollectionItem(collection, "")).not.toThrow();
  });

  it("guarantees every item carries a value entry for every field", () => {
    const document = createSiteEditorTestDocument();
    const collection = findSiteCollection(extractSiteCollections(document), "collection-1");
    const item = findSiteCollectionItem(collection, "");

    for (const field of collection.fields) {
      const value = findSiteCollectionItemValue(item, field.id);
      expect(value.fieldId).toBe(field.id);
    }
    expect(() => findSiteCollectionItemValue(item, "missing")).toThrow(/Value for field missing/);
  });
});
