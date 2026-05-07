/**
 * @file Site editor unit selection domain.
 */

import {
  createSingleItemSelection,
  selectSingleItem,
  type ItemSelectionState,
} from "@higma-editor-kernel/core/item-selection";

import type { SiteEditableUnit } from "../site-editor-workspace";

export type SiteUnitSelection = ItemSelectionState<string>;

function readFirstEditableUnit(units: readonly SiteEditableUnit[]): SiteEditableUnit {
  const firstUnit = units[0];
  if (!firstUnit) {
    throw new Error("Site unit selection requires at least one editable unit");
  }
  return firstUnit;
}

function findUnitIndex(units: readonly SiteEditableUnit[], unitId: string): number {
  const index = units.findIndex((unit) => unit.id === unitId);
  if (index < 0) {
    throw new Error(`Site unit selection target ${unitId} does not exist`);
  }
  return index;
}

/** Create the initial site editor selection from the first editable unit. */
export function createInitialSiteUnitSelection(units: readonly SiteEditableUnit[]): SiteUnitSelection {
  const firstUnit = readFirstEditableUnit(units);
  return createSingleItemSelection(firstUnit.id, 0);
}

/** Select a single site unit using editor-kernel item selection semantics. */
export function selectSiteUnit(units: readonly SiteEditableUnit[], unitId: string): SiteUnitSelection {
  const index = findUnitIndex(units, unitId);
  return selectSingleItem(unitId, index);
}

/** Resolve the primary selected unit from a site unit selection. */
export function resolveSelectedSiteUnit(
  units: readonly SiteEditableUnit[],
  selection: SiteUnitSelection,
): SiteEditableUnit {
  const primaryId = selection.primaryId;
  if (!primaryId) {
    throw new Error("Site unit selection requires a primary selected unit");
  }
  const selectedUnit = units.find((unit) => unit.id === primaryId);
  if (!selectedUnit) {
    throw new Error(`Site unit selection primary ${primaryId} does not exist`);
  }
  return selectedUnit;
}
