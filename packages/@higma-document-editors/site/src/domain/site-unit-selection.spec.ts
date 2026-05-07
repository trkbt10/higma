/**
 * @file Site unit selection tests.
 */

import type { SiteEditableUnit } from "../site-editor-workspace";
import {
  createInitialSiteUnitSelection,
  resolveSelectedSiteUnit,
  selectSiteUnit,
} from "./site-unit-selection";

const units: readonly SiteEditableUnit[] = [
  {
    kind: "site-editable-unit",
    id: "0:1",
    role: "repeater",
    label: "Articles",
    parentId: "0:0",
    childIds: ["0:2"],
    depth: 1,
    layoutScope: "repeater",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    responsiveSetId: null,
    responsiveBreakpointName: null,
    operationTarget: "site-layout-structure",
  },
  {
    kind: "site-editable-unit",
    id: "0:2",
    role: "cms-rich-text",
    label: "Body",
    parentId: "0:1",
    childIds: [],
    depth: 2,
    layoutScope: "cms-rich-text",
    bounds: { x: 10, y: 10, width: 80, height: 40 },
    responsiveSetId: null,
    responsiveBreakpointName: null,
    operationTarget: "site-layout-structure",
  },
];

describe("site unit selection", () => {
  it("creates a primary selection from the first editable unit", () => {
    expect(createInitialSiteUnitSelection(units)).toEqual({
      selectedIds: ["0:1"],
      primaryId: "0:1",
      anchorIndex: 0,
    });
  });

  it("selects a later unit and resolves it through the same selection state", () => {
    const selection = selectSiteUnit(units, "0:2");

    expect(selection).toEqual({
      selectedIds: ["0:2"],
      primaryId: "0:2",
      anchorIndex: 1,
    });
    expect(resolveSelectedSiteUnit(units, selection).label).toBe("Body");
  });

  it("throws when a selection target does not exist", () => {
    expect(() => selectSiteUnit(units, "missing")).toThrow("Site unit selection target missing does not exist");
  });
});
