/**
 * @file CMS Collection domain extraction tests.
 */

import type { SiteCmsBinding } from "@higma-document-renderers/site";
import { createSiteRenderPlan } from "@higma-document-renderers/site";

import { createSiteEditorTestDocument } from "../../spec/shared/site-editor-test-fixture";
import {
  extractSiteCollections,
  findSiteCollection,
  findSiteCollectionField,
  findSiteCollectionItem,
} from "./site-collections";

describe("extractSiteCollections", () => {
  it("aggregates selector bindings, field usages and items per collection", () => {
    const document = createSiteEditorTestDocument();
    const plan = createSiteRenderPlan(document);

    const collections = extractSiteCollections(plan);

    expect(collections.length).toBe(1);
    const collection = collections[0];
    if (!collection) {
      throw new Error("Expected at least one collection");
    }
    expect(collection.id).toBe("collection-1");
    expect(collection.fields.map((field) => field.id)).toEqual(["body"]);
    expect(collection.items.map((item) => item.id)).toEqual([""]);
    expect(collection.selectors.map((selector) => selector.unitId).sort())
      .toEqual(["0:1", "0:2", "0:5", "0:7"]);
    const bodyField = findSiteCollectionField(collection, "body");
    expect(bodyField.usages.length).toBe(3);
    expect(bodyField.usages.every((usage) => usage.variableField === "CMS_SERIALIZED_RICH_TEXT_DATA")).toBe(true);
    expect(bodyField.usages.every((usage) => usage.dataType === "CMS_ALIAS")).toBe(true);
    expect(bodyField.usages.map((usage) => usage.unitLabel).sort())
      .toEqual(["Body", "Mobile Body", "Tablet Body"]);
    const contextItem = findSiteCollectionItem(collection, "");
    expect(contextItem.bindings.length).toBe(3);
    expect(contextItem.bindings.every((binding) => binding.fieldId === "body")).toBe(true);
  });

  it("returns selectors with their filter and limit information intact", () => {
    const document = createSiteEditorTestDocument();
    const plan = createSiteRenderPlan(document);
    const collection = findSiteCollection(extractSiteCollections(plan), "collection-1");

    const responsiveSelector = collection.selectors.find((selector) => selector.unitRole === "responsive-set");
    if (!responsiveSelector) {
      throw new Error("Expected a responsive-set selector for the case study");
    }
    expect(responsiveSelector.matchType).toBe("MATCH_ALL");
    expect(responsiveSelector.limit).toBe(1);
    expect(responsiveSelector.filters.map((filter) => ({
      field: filter.fieldId,
      operator: filter.operator,
      value: filter.comparisonValue,
    }))).toEqual([{ field: "slug", operator: "EQUALS", value: "case-study" }]);

    const repeaterSelectors = collection.selectors.filter((selector) => selector.unitRole === "repeater");
    expect(repeaterSelectors.length).toBe(3);
    for (const selector of repeaterSelectors) {
      expect(selector.limit).toBe(0);
      expect(selector.filters.length).toBe(0);
    }
  });

  it("groups multiple collections separately when bindings reference distinct ids", () => {
    const bindings: readonly SiteCmsBinding[] = [
      {
        kind: "site-cms-selector-binding",
        unitId: "u-1",
        unitRole: "repeater",
        unitLabel: "Articles",
        collectionId: "alpha",
        matchType: "MATCH_ALL",
        filters: [],
        sortCount: 0,
        limit: 10,
      },
      {
        kind: "site-cms-rich-text-binding",
        unitId: "u-2",
        unitRole: "cms-rich-text",
        unitLabel: "Title",
        styleClasses: ["HEADING1"],
        aliases: [
          {
            source: "parameter",
            variableField: "CMS_SERIALIZED_RICH_TEXT_DATA",
            collectionId: "beta",
            fieldId: "title",
            itemId: "item-99",
            dataType: "CMS_ALIAS",
            resolvedDataType: "JS_RUNTIME_ALIAS",
          },
        ],
      },
    ];

    const collections = extractSiteCollections({ cmsBindings: bindings });

    expect(collections.map((collection) => collection.id)).toEqual(["alpha", "beta"]);
    const beta = findSiteCollection(collections, "beta");
    expect(beta.items.map((item) => item.id)).toEqual(["item-99"]);
    expect(beta.fields.map((field) => field.id)).toEqual(["title"]);
    expect(beta.fields[0]?.usages[0]?.itemId).toBe("item-99");
  });

  it("throws explicit errors when missing entities are requested", () => {
    const document = createSiteEditorTestDocument();
    const collections = extractSiteCollections(createSiteRenderPlan(document));

    expect(() => findSiteCollection(collections, "missing")).toThrow(/Site collection missing/);
    const collection = findSiteCollection(collections, "collection-1");
    expect(() => findSiteCollectionField(collection, "missing")).toThrow(/Field missing/);
    expect(() => findSiteCollectionItem(collection, "missing")).toThrow(/Item missing/);
    expect(() => findSiteCollectionItem(collection, "")).not.toThrow();
  });
});
