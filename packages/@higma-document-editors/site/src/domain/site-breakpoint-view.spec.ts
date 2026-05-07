/**
 * @file Active breakpoint view tests.
 */

import type { SiteBreakpointVariant } from "@higma-document-renderers/site";

import type { SiteEditableUnit } from "../site-editor-workspace";
import {
  createActiveSiteUnitBounds,
  createSiteCanvasRegions,
  filterSiteEditableUnitsForBreakpoint,
  filterSiteEditableUnitsForSurface,
} from "./site-breakpoint-view";

const units: readonly SiteEditableUnit[] = [
  {
    kind: "site-editable-unit",
    id: "root",
    role: "responsive-set",
    label: "Page",
    parentId: null,
    childIds: ["desktop-card", "mobile-card"],
    depth: 0,
    layoutScope: "responsive-set",
    bounds: { x: 100, y: 0, width: 900, height: 500 },
    responsiveSetId: "root",
    responsiveBreakpointName: null,
    operationTarget: "site-layout-structure",
  },
  {
    kind: "site-editable-unit",
    id: "desktop-card",
    role: "instance",
    label: "Card",
    parentId: "root",
    childIds: [],
    depth: 2,
    layoutScope: "instance",
    bounds: { x: 140, y: 50, width: 300, height: 180 },
    responsiveSetId: "root",
    responsiveBreakpointName: "Desktop",
    operationTarget: "site-layout-structure",
  },
  {
    kind: "site-editable-unit",
    id: "mobile-card",
    role: "instance",
    label: "Card",
    parentId: "root",
    childIds: [],
    depth: 2,
    layoutScope: "instance",
    bounds: { x: 640, y: 50, width: 180, height: 240 },
    responsiveSetId: "root",
    responsiveBreakpointName: "Mobile",
    operationTarget: "site-layout-structure",
  },
];

const variants: readonly SiteBreakpointVariant[] = [
  {
    kind: "site-breakpoint-variant",
    id: "desktop-frame",
    responsiveSetId: "root",
    breakpointName: "Desktop",
    bounds: { x: 120, y: 20, width: 360, height: 260 },
  },
  {
    kind: "site-breakpoint-variant",
    id: "secondary-desktop-frame",
    responsiveSetId: "secondary",
    breakpointName: "Desktop",
    bounds: { x: 900, y: 20, width: 360, height: 260 },
  },
  {
    kind: "site-breakpoint-variant",
    id: "mobile-frame",
    responsiveSetId: "root",
    breakpointName: "Mobile",
    bounds: { x: 620, y: 20, width: 220, height: 320 },
  },
];

describe("active site breakpoint view", () => {
  it("keeps neutral units and the active breakpoint variant units", () => {
    expect(filterSiteEditableUnitsForBreakpoint(units, "Desktop").map((unit) => unit.id)).toEqual([
      "root",
      "desktop-card",
    ]);
  });

  it("keeps only units in the active site surface", () => {
    expect(filterSiteEditableUnitsForSurface(units, "root").map((unit) => unit.id)).toEqual([
      "root",
      "desktop-card",
      "mobile-card",
    ]);
  });

  it("projects responsive-set root bounds to the active variant frame", () => {
    const bounds = createActiveSiteUnitBounds({
      units: filterSiteEditableUnitsForBreakpoint(units, "Mobile"),
      moves: [{ unitId: "root", deltaX: 10, deltaY: 5 }],
      variants,
      breakpointName: "Mobile",
    });

    expect(bounds.find((item) => item.id === "root")).toMatchObject({
      x: 630,
      y: 25,
      width: 220,
      height: 320,
    });
    expect(bounds.find((item) => item.id === "mobile-card")).toMatchObject({
      x: 650,
      y: 55,
    });
  });

  it("uses active variant frames as canvas regions", () => {
    expect(createSiteCanvasRegions({
      moves: [],
      variants,
      breakpointName: "Desktop",
      surfaceId: null,
      viewport: { x: 0, y: 0, width: 1000, height: 800 },
    })).toEqual([
      { x: 120, y: 20, width: 360, height: 260 },
      { x: 900, y: 20, width: 360, height: 260 },
    ]);
  });

  it("uses the active surface variant frame as the canvas region", () => {
    expect(createSiteCanvasRegions({
      moves: [],
      variants,
      breakpointName: "Desktop",
      surfaceId: "root",
      viewport: { x: 0, y: 0, width: 1000, height: 800 },
    })).toEqual([
      { x: 120, y: 20, width: 360, height: 260 },
    ]);
  });
});
