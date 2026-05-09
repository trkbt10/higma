/**
 * @file Site editor unit bounds domain.
 */

import type { EditorCanvasItemBounds } from "@higma-editor-surfaces/controls/canvas";

import type { SiteEditableUnit } from "../site-editor-workspace";


export type SiteUnitMove = {
  readonly unitId: string;
  readonly deltaX: number;
  readonly deltaY: number;
};

export type SiteUnitMoveDraft = {
  readonly unitId: string;
  readonly startPageX: number;
  readonly startPageY: number;
  readonly currentPageX: number;
  readonly currentPageY: number;
  readonly originMove: SiteUnitMove;
};

function readUnitBounds(unit: SiteEditableUnit): EditorCanvasItemBounds {
  return {
    id: unit.id,
    x: unit.bounds.x,
    y: unit.bounds.y,
    width: unit.bounds.width,
    height: unit.bounds.height,
  };
}

function createUnitMap(units: readonly SiteEditableUnit[]): ReadonlyMap<string, SiteEditableUnit> {
  return new Map(units.map((unit) => [unit.id, unit]));
}

function unitHasMovedAncestor(
  unit: SiteEditableUnit,
  movedUnitId: string,
  unitsById: ReadonlyMap<string, SiteEditableUnit>,
): boolean {
  if (unit.id === movedUnitId) {
    return true;
  }
  if (!unit.parentId) {
    return false;
  }
  const parent = unitsById.get(unit.parentId);
  if (!parent) {
    return false;
  }
  return unitHasMovedAncestor(parent, movedUnitId, unitsById);
}

function moveAffectsUnit(
  unit: SiteEditableUnit,
  move: SiteUnitMove,
  unitsById: ReadonlyMap<string, SiteEditableUnit>,
): boolean {
  return unitHasMovedAncestor(unit, move.unitId, unitsById);
}

function movedUnitDelta(
  unit: SiteEditableUnit,
  moves: readonly SiteUnitMove[],
  unitsById: ReadonlyMap<string, SiteEditableUnit>,
): { readonly x: number; readonly y: number } {
  return moves.reduce((delta, move) => {
    if (!moveAffectsUnit(unit, move, unitsById)) {
      return delta;
    }
    return {
      x: delta.x + move.deltaX,
      y: delta.y + move.deltaY,
    };
  }, { x: 0, y: 0 });
}

function readMovedUnitBounds(
  unit: SiteEditableUnit,
  moves: readonly SiteUnitMove[],
  unitsById: ReadonlyMap<string, SiteEditableUnit>,
): EditorCanvasItemBounds {
  const baseBounds = readUnitBounds(unit);
  const delta = movedUnitDelta(unit, moves, unitsById);
  return {
    ...baseBounds,
    x: baseBounds.x + delta.x,
    y: baseBounds.y + delta.y,
  };
}

/** Create editor canvas bounds from editable units and committed move operations. */
export function createSiteUnitBounds(
  units: readonly SiteEditableUnit[],
  moves: readonly SiteUnitMove[] = [],
): readonly EditorCanvasItemBounds[] {
  if (units.length === 0) {
    throw new Error("Site unit bounds require at least one editable unit");
  }
  const unitsById = createUnitMap(units);
  return units.map((unit) => readMovedUnitBounds(unit, moves, unitsById));
}

/** Resolve bounds for a specific site unit. */
export function resolveSiteUnitBounds(bounds: readonly EditorCanvasItemBounds[], unitId: string): EditorCanvasItemBounds {
  const unitBounds = bounds.find((item) => item.id === unitId);
  if (!unitBounds) {
    throw new Error(`Site unit bounds for ${unitId} do not exist`);
  }
  return unitBounds;
}

/** Begin a graphical move operation for a site unit. */
export function beginSiteUnitMove(params: {
  readonly moves: readonly SiteUnitMove[];
  readonly unitId: string;
  readonly pageX: number;
  readonly pageY: number;
}): SiteUnitMoveDraft {
  const originMove = resolveSiteUnitMove(params.moves, params.unitId);
  return {
    unitId: params.unitId,
    startPageX: params.pageX,
    startPageY: params.pageY,
    currentPageX: params.pageX,
    currentPageY: params.pageY,
    originMove,
  };
}

/** Update the current coordinate tracked by an active graphical move draft. */
export function updateSiteUnitMoveDraft(params: {
  readonly draft: SiteUnitMoveDraft;
  readonly pageX: number;
  readonly pageY: number;
}): SiteUnitMoveDraft {
  return {
    ...params.draft,
    currentPageX: params.pageX,
    currentPageY: params.pageY,
  };
}

function createSiteUnitMoveFromDraft(draft: SiteUnitMoveDraft): SiteUnitMove {
  return {
    unitId: draft.unitId,
    deltaX: draft.originMove.deltaX + draft.currentPageX - draft.startPageX,
    deltaY: draft.originMove.deltaY + draft.currentPageY - draft.startPageY,
  };
}

function resolveSiteUnitMove(moves: readonly SiteUnitMove[], unitId: string): SiteUnitMove {
  const move = moves.find((item) => item.unitId === unitId);
  if (move) {
    return move;
  }
  return { unitId, deltaX: 0, deltaY: 0 };
}

function upsertSiteUnitMove(moves: readonly SiteUnitMove[], move: SiteUnitMove): readonly SiteUnitMove[] {
  return [...moves.filter((item) => item.unitId !== move.unitId), move];
}

/** Return committed moves with the active draft preview applied. */
export function previewSiteUnitMoves(
  moves: readonly SiteUnitMove[],
  draft: SiteUnitMoveDraft | null,
): readonly SiteUnitMove[] {
  if (!draft) {
    return moves;
  }
  return upsertSiteUnitMove(moves, createSiteUnitMoveFromDraft(draft));
}

/** Commit a graphical move draft into the direct unit move list. */
export function commitSiteUnitMove(params: {
  readonly moves: readonly SiteUnitMove[];
  readonly draft: SiteUnitMoveDraft;
  readonly pageX: number;
  readonly pageY: number;
}): readonly SiteUnitMove[] {
  const draft = updateSiteUnitMoveDraft({ draft: params.draft, pageX: params.pageX, pageY: params.pageY });
  return upsertSiteUnitMove(params.moves, createSiteUnitMoveFromDraft(draft));
}

/** Commit an absolute position edit for the currently visible unit bounds. */
export function moveSiteUnitBoundsToPosition(params: {
  readonly moves: readonly SiteUnitMove[];
  readonly bounds: EditorCanvasItemBounds;
  readonly x: number;
  readonly y: number;
}): readonly SiteUnitMove[] {
  if (!Number.isFinite(params.x) || !Number.isFinite(params.y)) {
    throw new Error(`Site unit position requires finite coordinates for ${params.bounds.id}`);
  }
  const originMove = resolveSiteUnitMove(params.moves, params.bounds.id);
  return upsertSiteUnitMove(params.moves, {
    unitId: params.bounds.id,
    deltaX: originMove.deltaX + params.x - params.bounds.x,
    deltaY: originMove.deltaY + params.y - params.bounds.y,
  });
}
