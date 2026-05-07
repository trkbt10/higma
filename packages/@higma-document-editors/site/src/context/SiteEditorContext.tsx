/**
 * @file Site editor React context.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SiteDocument } from "@higma-document-models/site";
import {
  createSiteDocumentWithUnitMoves,
  type SiteBreakpointVariant,
  type SiteRenderSurface,
} from "@higma-document-renderers/site";

import {
  createSiteFigRenderSurface,
  type SiteEditableUnit,
  type SiteEditorWorkspace,
  type SiteFigRenderSurface,
} from "../site-editor-workspace";
import {
  createInitialSiteUnitSelection,
  resolveSelectedSiteUnit,
  selectSiteUnit,
  type SiteUnitSelection,
} from "../domain/site-unit-selection";
import {
  beginSiteUnitMove,
  commitSiteUnitMove,
  moveSiteUnitBoundsToPosition,
  previewSiteUnitMoves,
  resolveSiteUnitBounds,
  updateSiteUnitMoveDraft,
  type SiteUnitBounds,
  type SiteUnitMove,
  type SiteUnitMoveDraft,
} from "../domain/site-unit-bounds";
import {
  createActiveSiteUnitBounds,
  createSiteCanvasRegions,
  filterSiteEditableUnitsForBreakpoint,
  filterSiteEditableUnitsForSurface,
  type SiteCanvasRegion,
} from "../domain/site-breakpoint-view";

export type SiteEditorEditState = {
  readonly document: SiteDocument;
  readonly figRenderSurface: SiteFigRenderSurface;
  readonly unitBounds: readonly SiteUnitBounds[];
  readonly unitMoves: readonly SiteUnitMove[];
};

export type SiteEditorContextValue = {
  readonly workspace: SiteEditorWorkspace;
  readonly editableUnits: readonly SiteEditableUnit[];
  readonly document: SiteDocument;
  readonly figRenderSurface: SiteFigRenderSurface;
  readonly unitSelection: SiteUnitSelection;
  readonly unitBounds: readonly SiteUnitBounds[];
  readonly unitMoves: readonly SiteUnitMove[];
  readonly canvasRegions: readonly SiteCanvasRegion[];
  readonly activeSurfaceId: string;
  readonly activeSurface: SiteRenderSurface;
  readonly activeBreakpointId: string | null;
  readonly activeBreakpointName: string | null;
  readonly selectedUnitId: string;
  readonly selectedUnit: SiteEditableUnit;
  readonly selectedUnitBounds: SiteUnitBounds;
  readonly setActiveSurfaceId: (surfaceId: string) => void;
  readonly setActiveBreakpointId: (breakpointId: string) => void;
  readonly setSelectedUnitId: (unitId: string) => void;
  readonly setSelectedUnitPosition: (x: number, y: number) => void;
  readonly beginMoveUnit: (unitId: string, pageX: number, pageY: number) => void;
  readonly moveActiveUnit: (pageX: number, pageY: number) => void;
  readonly endActiveUnitMove: (pageX: number, pageY: number) => void;
};

const SiteEditorContext = createContext<SiteEditorContextValue | null>(null);

function readInitialBreakpointId(workspace: SiteEditorWorkspace): string | null {
  const breakpoint = workspace.breakpoints[0];
  if (!breakpoint) {
    return null;
  }
  return breakpoint.id;
}

function surfaceSupportsAllBreakpoints(surface: SiteRenderSurface, workspace: SiteEditorWorkspace): boolean {
  return workspace.breakpoints.every((breakpoint) => surface.breakpointNames.includes(breakpoint.name));
}

function readInitialSurfaceId(workspace: SiteEditorWorkspace): string {
  const completeSurface = workspace.surfaces.find((surface) => surfaceSupportsAllBreakpoints(surface, workspace));
  if (completeSurface) {
    return completeSurface.id;
  }
  const surface = workspace.surfaces[0];
  if (!surface) {
    throw new Error("SiteEditorProvider requires at least one site render surface");
  }
  return surface.id;
}

function assertSurfaceExists(workspace: SiteEditorWorkspace, surfaceId: string): void {
  if (!workspace.surfaces.some((surface) => surface.id === surfaceId)) {
    throw new Error(`SiteEditorProvider could not find site surface ${surfaceId}`);
  }
}

function resolveActiveSurface(workspace: SiteEditorWorkspace, surfaceId: string): SiteRenderSurface {
  const surface = workspace.surfaces.find((item) => item.id === surfaceId);
  if (!surface) {
    throw new Error(`SiteEditorProvider could not find site surface ${surfaceId}`);
  }
  return surface;
}

function assertBreakpointExists(workspace: SiteEditorWorkspace, breakpointId: string): void {
  if (!workspace.breakpoints.some((breakpoint) => breakpoint.id === breakpointId)) {
    throw new Error(`SiteEditorProvider could not find breakpoint ${breakpointId}`);
  }
}

function resolveActiveBreakpointName(workspace: SiteEditorWorkspace, breakpointId: string | null): string | null {
  if (!breakpointId) {
    return null;
  }
  const breakpoint = workspace.breakpoints.find((item) => item.id === breakpointId);
  if (!breakpoint) {
    throw new Error(`SiteEditorProvider could not find breakpoint ${breakpointId}`);
  }
  return breakpoint.name;
}

function resolveBreakpointIdForSurface(
  workspace: SiteEditorWorkspace,
  surfaceId: string,
  breakpointId: string | null,
): string | null {
  const surface = resolveActiveSurface(workspace, surfaceId);
  if (breakpointId) {
    const breakpoint = workspace.breakpoints.find((item) => item.id === breakpointId);
    if (!breakpoint) {
      throw new Error(`SiteEditorProvider could not find breakpoint ${breakpointId}`);
    }
    if (surface.breakpointNames.includes(breakpoint.name)) {
      return breakpointId;
    }
  }
  const breakpoint = workspace.breakpoints.find((item) => surface.breakpointNames.includes(item.name));
  if (!breakpoint) {
    throw new Error(`SiteEditorProvider could not find a breakpoint for site surface ${surfaceId}`);
  }
  return breakpoint.id;
}

function assertSurfaceSupportsBreakpoint(
  workspace: SiteEditorWorkspace,
  surfaceId: string,
  breakpointId: string,
): void {
  const surface = resolveActiveSurface(workspace, surfaceId);
  const breakpoint = workspace.breakpoints.find((item) => item.id === breakpointId);
  if (!breakpoint) {
    throw new Error(`SiteEditorProvider could not find breakpoint ${breakpointId}`);
  }
  if (!surface.breakpointNames.includes(breakpoint.name)) {
    throw new Error(`Site surface ${surfaceId} does not support breakpoint ${breakpoint.name}`);
  }
}

function selectionExistsInUnits(units: readonly SiteEditableUnit[], selection: SiteUnitSelection): boolean {
  const primaryId = selection.primaryId;
  if (!primaryId) {
    return false;
  }
  return units.some((unit) => unit.id === primaryId);
}

function responsiveSetHasVariant(
  variants: readonly SiteBreakpointVariant[],
  responsiveSetId: string | null,
  breakpointName: string | null,
): boolean {
  if (!breakpointName || !responsiveSetId) {
    return true;
  }
  return variants.some((variant) => variant.responsiveSetId === responsiveSetId && variant.breakpointName === breakpointName);
}

function createInitialVisibleSelection(units: readonly SiteEditableUnit[], surfaceId: string): SiteUnitSelection {
  const unit = units.find((item) => item.id !== surfaceId);
  if (unit) {
    return selectSiteUnit(units, unit.id);
  }
  return createInitialSiteUnitSelection(units);
}

function createInitialSelectionForSurface(
  workspace: SiteEditorWorkspace,
  surfaceId: string,
  breakpointName: string | null,
): SiteUnitSelection {
  const surfaceUnits = filterSiteEditableUnitsForSurface(workspace.editableUnits, surfaceId);
  const units = filterSiteEditableUnitsForBreakpoint(surfaceUnits, breakpointName);
  return createInitialVisibleSelection(units, surfaceId);
}

function createSelectionForResponsiveSet(units: readonly SiteEditableUnit[], responsiveSetId: string, surfaceId: string): SiteUnitSelection {
  const unit = units.find((item) => item.id !== surfaceId && item.responsiveSetId === responsiveSetId);
  if (!unit) {
    throw new Error(`SiteEditorProvider could not find unit for responsive set ${responsiveSetId}`);
  }
  return selectSiteUnit(units, unit.id);
}

function resolveVisibleSelection(
  units: readonly SiteEditableUnit[],
  selection: SiteUnitSelection,
  variants: readonly SiteBreakpointVariant[],
  breakpointName: string | null,
  surfaceId: string,
): SiteUnitSelection {
  const selectedUnit = units.find((unit) => unit.id === selection.primaryId);
  if (selectionExistsInUnits(units, selection) && responsiveSetHasVariant(variants, selectedUnit?.responsiveSetId ?? null, breakpointName)) {
    return selection;
  }
  const responsiveSetId = units.find((unit) => unit.responsiveSetId)?.responsiveSetId;
  if (responsiveSetId) {
    return createSelectionForResponsiveSet(units, responsiveSetId, surfaceId);
  }
  return createInitialVisibleSelection(units, surfaceId);
}

/** Provide site editor workspace and selected unit state. */
export function SiteEditorProvider({
  workspace,
  onEditStateChange,
  children,
}: {
  readonly workspace: SiteEditorWorkspace;
  readonly onEditStateChange?: (state: SiteEditorEditState) => void;
  readonly children: ReactNode;
}) {
  const initialSurfaceId = readInitialSurfaceId(workspace);
  const initialBreakpointId = resolveBreakpointIdForSurface(workspace, initialSurfaceId, readInitialBreakpointId(workspace));
  const initialBreakpointName = resolveActiveBreakpointName(workspace, initialBreakpointId);
  const [unitSelection, setUnitSelection] = useState(() => (
    createInitialSelectionForSurface(workspace, initialSurfaceId, initialBreakpointName)
  ));
  const [unitMoves, setUnitMoves] = useState<readonly SiteUnitMove[]>([]);
  const [moveDraft, setMoveDraft] = useState<SiteUnitMoveDraft | null>(null);
  const unitMovesRef = useRef<readonly SiteUnitMove[]>([]);
  const moveDraftRef = useRef<SiteUnitMoveDraft | null>(null);
  const [activeSurfaceId, setActiveSurfaceIdState] = useState<string>(() => initialSurfaceId);
  const [activeBreakpointId, setActiveBreakpointId] = useState<string | null>(() => initialBreakpointId);
  const activeSurface = useMemo(
    () => resolveActiveSurface(workspace, activeSurfaceId),
    [workspace, activeSurfaceId],
  );
  const activeBreakpointName = useMemo(
    () => resolveActiveBreakpointName(workspace, activeBreakpointId),
    [workspace, activeBreakpointId],
  );
  const surfaceUnits = useMemo(
    () => filterSiteEditableUnitsForSurface(workspace.editableUnits, activeSurfaceId),
    [workspace.editableUnits, activeSurfaceId],
  );
  const editableUnits = useMemo(
    () => filterSiteEditableUnitsForBreakpoint(surfaceUnits, activeBreakpointName),
    [surfaceUnits, activeBreakpointName],
  );
  const visibleUnitSelection = useMemo(
    () => resolveVisibleSelection(editableUnits, unitSelection, workspace.breakpointVariants, activeBreakpointName, activeSurfaceId),
    [editableUnits, unitSelection, workspace.breakpointVariants, activeBreakpointName, activeSurfaceId],
  );
  const previewMoves = useMemo(() => previewSiteUnitMoves(unitMoves, moveDraft), [unitMoves, moveDraft]);
  const unitBounds = useMemo(
    () => createActiveSiteUnitBounds({
      units: editableUnits,
      moves: previewMoves,
      variants: workspace.breakpointVariants,
      breakpointName: activeBreakpointName,
    }),
    [editableUnits, previewMoves, workspace.breakpointVariants, activeBreakpointName],
  );
  const canvasRegions = useMemo(
    () => createSiteCanvasRegions({
      moves: previewMoves,
      variants: workspace.breakpointVariants,
      breakpointName: activeBreakpointName,
      surfaceId: activeSurfaceId,
      viewport: workspace.renderPlan.viewport,
    }),
    [previewMoves, workspace.breakpointVariants, activeBreakpointName, activeSurfaceId, workspace.renderPlan.viewport],
  );
  const document = useMemo(
    () => createSiteDocumentWithUnitMoves(workspace.session.document, previewMoves),
    [workspace.session.document, previewMoves],
  );
  const figRenderSurface = useMemo(
    () => createSiteFigRenderSurface(document, {
      activeSurfaceId,
      activeBreakpointName,
      breakpointVariants: workspace.breakpointVariants,
    }),
    [document, activeSurfaceId, activeBreakpointName, workspace.breakpointVariants],
  );
  const selectedUnit = useMemo(
    () => resolveSelectedSiteUnit(editableUnits, visibleUnitSelection),
    [editableUnits, visibleUnitSelection],
  );
  const selectedUnitId = selectedUnit.id;
  const selectedUnitBounds = useMemo(
    () => resolveSiteUnitBounds(unitBounds, selectedUnitId),
    [unitBounds, selectedUnitId],
  );
  useEffect(() => {
    unitMovesRef.current = unitMoves;
  }, [unitMoves]);
  useEffect(() => {
    onEditStateChange?.({
      document,
      figRenderSurface,
      unitBounds,
      unitMoves: previewMoves,
    });
  }, [onEditStateChange, document, figRenderSurface, unitBounds, previewMoves]);
  const value = useMemo<SiteEditorContextValue>(
    () => ({
      workspace,
      editableUnits,
      document,
      figRenderSurface,
      unitSelection: visibleUnitSelection,
      unitBounds,
      unitMoves: previewMoves,
      canvasRegions,
      activeSurfaceId,
      activeSurface,
      activeBreakpointId,
      activeBreakpointName,
      selectedUnitId,
      selectedUnit,
      selectedUnitBounds,
      setActiveSurfaceId: (surfaceId) => {
        assertSurfaceExists(workspace, surfaceId);
        setActiveSurfaceIdState(surfaceId);
        setActiveBreakpointId((currentBreakpointId) => resolveBreakpointIdForSurface(workspace, surfaceId, currentBreakpointId));
      },
      setActiveBreakpointId: (breakpointId) => {
        assertBreakpointExists(workspace, breakpointId);
        assertSurfaceSupportsBreakpoint(workspace, activeSurfaceId, breakpointId);
        setActiveBreakpointId(breakpointId);
      },
      setSelectedUnitId: (unitId) => setUnitSelection(selectSiteUnit(editableUnits, unitId)),
      setSelectedUnitPosition: (x, y) => {
        moveDraftRef.current = null;
        setMoveDraft(null);
        setUnitMoves((currentMoves) => moveSiteUnitBoundsToPosition({ moves: currentMoves, bounds: selectedUnitBounds, x, y }));
      },
      beginMoveUnit: (unitId, pageX, pageY) => {
        setUnitSelection(selectSiteUnit(editableUnits, unitId));
        const draft = beginSiteUnitMove({ moves: unitMovesRef.current, unitId, pageX, pageY });
        moveDraftRef.current = draft;
        setMoveDraft(draft);
      },
      moveActiveUnit: (pageX, pageY) => {
        const draft = moveDraftRef.current;
        if (!draft) {
          return;
        }
        const nextDraft = updateSiteUnitMoveDraft({ draft, pageX, pageY });
        moveDraftRef.current = nextDraft;
        setMoveDraft(nextDraft);
      },
      endActiveUnitMove: (pageX, pageY) => {
        const draft = moveDraftRef.current;
        if (!draft) {
          return;
        }
        moveDraftRef.current = null;
        setUnitMoves((currentMoves) => commitSiteUnitMove({ moves: currentMoves, draft, pageX, pageY }));
        setMoveDraft(null);
      },
    }),
    [
      workspace,
      editableUnits,
      document,
      figRenderSurface,
      visibleUnitSelection,
      unitBounds,
      previewMoves,
      canvasRegions,
      activeSurfaceId,
      activeSurface,
      activeBreakpointId,
      activeBreakpointName,
      selectedUnitId,
      selectedUnit,
      selectedUnitBounds,
    ],
  );

  return <SiteEditorContext.Provider value={value}>{children}</SiteEditorContext.Provider>;
}

/** Read the active site editor context. */
export function useSiteEditor(): SiteEditorContextValue {
  const value = useContext(SiteEditorContext);
  if (!value) {
    throw new Error("useSiteEditor must be used within SiteEditorProvider");
  }
  return value;
}
