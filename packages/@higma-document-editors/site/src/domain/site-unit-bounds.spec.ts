/**
 * @file Site unit bounds tests.
 */

import type { SiteEditableUnit } from "../site-editor-workspace";
import {
  beginSiteUnitMove,
  commitSiteUnitMove,
  createSiteUnitBounds,
  moveSiteUnitBoundsToPosition,
  previewSiteUnitMoves,
  resolveSiteUnitBounds,
  updateSiteUnitMoveDraft,
} from "./site-unit-bounds";

const units: readonly SiteEditableUnit[] = [
  {
    kind: "site-editable-unit",
    id: "0:1",
    role: "responsive-set",
    label: "Page",
    parentId: "0:0",
    childIds: [],
    depth: 1,
    layoutScope: "responsive-set",
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    responsiveSetId: "0:1",
    responsiveBreakpointName: null,
    operationTarget: "site-layout-structure",
  },
  {
    kind: "site-editable-unit",
    id: "0:2",
    role: "repeater",
    label: "Child",
    parentId: "0:1",
    childIds: [],
    depth: 2,
    layoutScope: "repeater",
    bounds: { x: 40, y: 60, width: 100, height: 80 },
    responsiveSetId: "0:1",
    responsiveBreakpointName: "Desktop",
    operationTarget: "site-layout-structure",
  },
];

describe("site unit bounds", () => {
  it("creates canvas item bounds from editable unit bounds", () => {
    expect(createSiteUnitBounds(units)).toEqual([
      { id: "0:1", x: 10, y: 20, width: 300, height: 200 },
      { id: "0:2", x: 40, y: 60, width: 100, height: 80 },
    ]);
  });

  it("previews move operations on the target unit and its descendants", () => {
    const draft = beginSiteUnitMove({ moves: [], unitId: "0:1", pageX: 15, pageY: 25 });
    const moved = createSiteUnitBounds(units, previewSiteUnitMoves(
      [],
      updateSiteUnitMoveDraft({ draft, pageX: 25, pageY: 40 }),
    ));

    expect(resolveSiteUnitBounds(moved, "0:1")).toEqual({
      id: "0:1",
      x: 20,
      y: 35,
      width: 300,
      height: 200,
    });
    expect(resolveSiteUnitBounds(moved, "0:2")).toEqual({
      id: "0:2",
      x: 50,
      y: 75,
      width: 100,
      height: 80,
    });
  });

  it("commits direct unit moves without duplicating descendant transforms", () => {
    const draft = beginSiteUnitMove({ moves: [], unitId: "0:1", pageX: 15, pageY: 25 });
    const moves = commitSiteUnitMove({ moves: [], draft, pageX: 25, pageY: 40 });

    expect(moves).toEqual([{ unitId: "0:1", deltaX: 10, deltaY: 15 }]);
  });

  it("commits absolute position edits from current visible bounds", () => {
    const movedBounds = { id: "0:2", x: 50, y: 75, width: 100, height: 80 };
    const moves = moveSiteUnitBoundsToPosition({
      moves: [{ unitId: "0:2", deltaX: 10, deltaY: 15 }],
      bounds: movedBounds,
      x: 80,
      y: 90,
    });

    expect(moves).toEqual([{ unitId: "0:2", deltaX: 40, deltaY: 30 }]);
  });
});
