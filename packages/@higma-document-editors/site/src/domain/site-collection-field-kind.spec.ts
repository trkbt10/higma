/**
 * @file Field-kind classification tests.
 */

import {
  classifySiteCollectionFieldKind,
  classifySiteCollectionFieldKindFromAll,
  getSiteCollectionFieldKindLabel,
} from "./site-collection-field-kind";

describe("classifySiteCollectionFieldKind", () => {
  it("maps every documented variableField name to its kind", () => {
    expect(classifySiteCollectionFieldKind("TEXT_DATA")).toBe("text");
    expect(classifySiteCollectionFieldKind("CMS_SERIALIZED_RICH_TEXT_DATA")).toBe("rich-text");
    expect(classifySiteCollectionFieldKind("DATE_DATA")).toBe("date");
    expect(classifySiteCollectionFieldKind("URL_DATA")).toBe("link");
    expect(classifySiteCollectionFieldKind("IMAGE_FILL_PAINT")).toBe("image");
    expect(classifySiteCollectionFieldKind("NUMBER_DATA")).toBe("number");
    expect(classifySiteCollectionFieldKind("BOOLEAN_DATA")).toBe("boolean");
  });

  it("throws on unknown variableField names instead of falling back", () => {
    expect(() => classifySiteCollectionFieldKind("MYSTERY_FIELD")).toThrow(/Unknown CMS variableField "MYSTERY_FIELD"/);
  });
});

describe("classifySiteCollectionFieldKindFromAll", () => {
  it("returns the unique kind when all variableFields agree", () => {
    expect(classifySiteCollectionFieldKindFromAll(["TEXT_DATA", "TEXT_DATA"])).toBe("text");
  });

  it("throws on empty input rather than picking a default", () => {
    expect(() => classifySiteCollectionFieldKindFromAll([])).toThrow(/at least one variableField/);
  });

  it("throws when variableFields would resolve to mixed kinds", () => {
    expect(() => classifySiteCollectionFieldKindFromAll(["TEXT_DATA", "DATE_DATA"]))
      .toThrow(/Cannot reduce mixed CMS field kinds/);
  });
});

describe("getSiteCollectionFieldKindLabel", () => {
  it("returns a stable display label for each kind", () => {
    expect(getSiteCollectionFieldKindLabel("text")).toBe("Text");
    expect(getSiteCollectionFieldKindLabel("rich-text")).toBe("Rich Text");
    expect(getSiteCollectionFieldKindLabel("boolean")).toBe("Toggle");
  });
});
