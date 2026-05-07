/**
 * @file Active breakpoint projection for site editor structure and canvas.
 */

import type { SiteBreakpointVariant, SiteRenderViewport } from "@higma-document-renderers/site";

import type { SiteEditableUnit } from "../site-editor-workspace";
import { createSiteUnitBounds, type SiteUnitBounds, type SiteUnitMove } from "./site-unit-bounds";

export type SiteCanvasRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function unitVisibleForBreakpoint(unit: SiteEditableUnit, breakpointName: string | null): boolean {
  if (!breakpointName) {
    return true;
  }
  if (!unit.responsiveBreakpointName) {
    return true;
  }
  return unit.responsiveBreakpointName === breakpointName;
}

function unitBelongsToSurface(unit: SiteEditableUnit, surfaceId: string): boolean {
  return unit.id === surfaceId || unit.responsiveSetId === surfaceId;
}

/** Keep units that belong to the active site surface. */
export function filterSiteEditableUnitsForSurface(
  units: readonly SiteEditableUnit[],
  surfaceId: string,
): readonly SiteEditableUnit[] {
  const filtered = units.filter((unit) => unitBelongsToSurface(unit, surfaceId));
  if (filtered.length === 0) {
    throw new Error(`Active site surface ${surfaceId} has no editable units`);
  }
  return filtered;
}

/** Keep breakpoint-neutral units and units that belong to the active breakpoint variant. */
export function filterSiteEditableUnitsForBreakpoint(
  units: readonly SiteEditableUnit[],
  breakpointName: string | null,
): readonly SiteEditableUnit[] {
  const filtered = units.filter((unit) => unitVisibleForBreakpoint(unit, breakpointName));
  if (filtered.length === 0) {
    throw new Error(`Active site breakpoint ${breakpointName ?? "all"} has no editable units`);
  }
  return filtered;
}

function findUnit(units: readonly SiteEditableUnit[], unitId: string): SiteEditableUnit {
  const unit = units.find((item) => item.id === unitId);
  if (!unit) {
    throw new Error(`Site breakpoint view could not find unit ${unitId}`);
  }
  return unit;
}

function rootMoveDelta(unit: SiteEditableUnit, movedBounds: SiteUnitBounds): { readonly x: number; readonly y: number } {
  return {
    x: movedBounds.x - unit.bounds.x,
    y: movedBounds.y - unit.bounds.y,
  };
}

function findVariantForUnit(
  variants: readonly SiteBreakpointVariant[],
  unit: SiteEditableUnit,
  breakpointName: string,
): SiteBreakpointVariant | null {
  if (unit.role !== "responsive-set") {
    return null;
  }
  const variant = variants.find((item) => item.responsiveSetId === unit.id && item.breakpointName === breakpointName);
  if (!variant) {
    return null;
  }
  return variant;
}

function projectResponsiveSetBounds(
  unit: SiteEditableUnit,
  bounds: SiteUnitBounds,
  variants: readonly SiteBreakpointVariant[],
  breakpointName: string | null,
): SiteUnitBounds {
  if (!breakpointName) {
    return bounds;
  }
  const variant = findVariantForUnit(variants, unit, breakpointName);
  if (!variant) {
    return bounds;
  }
  const delta = rootMoveDelta(unit, bounds);
  return {
    ...bounds,
    x: variant.bounds.x + delta.x,
    y: variant.bounds.y + delta.y,
    width: variant.bounds.width,
    height: variant.bounds.height,
  };
}

/** Create visible unit bounds with responsive-set roots projected to their active variant frame. */
export function createActiveSiteUnitBounds(params: {
  readonly units: readonly SiteEditableUnit[];
  readonly moves: readonly SiteUnitMove[];
  readonly variants: readonly SiteBreakpointVariant[];
  readonly breakpointName: string | null;
}): readonly SiteUnitBounds[] {
  const baseBounds = createSiteUnitBounds(params.units, params.moves);
  return baseBounds.map((bounds) => {
    const unit = findUnit(params.units, bounds.id);
    return projectResponsiveSetBounds(unit, bounds, params.variants, params.breakpointName);
  });
}

function moveDelta(moves: readonly SiteUnitMove[], unitId: string): { readonly x: number; readonly y: number } {
  const move = moves.find((item) => item.unitId === unitId);
  if (!move) {
    return { x: 0, y: 0 };
  }
  return { x: move.deltaX, y: move.deltaY };
}

function projectVariantRegion(
  moves: readonly SiteUnitMove[],
  variant: SiteBreakpointVariant,
): SiteCanvasRegion {
  const delta = moveDelta(moves, variant.responsiveSetId);
  return {
    x: variant.bounds.x + delta.x,
    y: variant.bounds.y + delta.y,
    width: variant.bounds.width,
    height: variant.bounds.height,
  };
}

/** Create clip/viewport regions for the active breakpoint from explicit responsive variant frames. */
export function createSiteCanvasRegions(params: {
  readonly moves: readonly SiteUnitMove[];
  readonly variants: readonly SiteBreakpointVariant[];
  readonly breakpointName: string | null;
  readonly surfaceId: string | null;
  readonly viewport: SiteRenderViewport;
}): readonly SiteCanvasRegion[] {
  if (!params.breakpointName) {
    return [params.viewport];
  }
  const variants = params.variants
    .filter((variant) => variant.breakpointName === params.breakpointName)
    .filter((variant) => {
      if (!params.surfaceId) {
        return true;
      }
      return variant.responsiveSetId === params.surfaceId;
    });
  if (variants.length === 0) {
    throw new Error(`Site canvas regions require variant frames for breakpoint ${params.breakpointName}`);
  }
  return variants.map((variant) => projectVariantRegion(params.moves, variant));
}
