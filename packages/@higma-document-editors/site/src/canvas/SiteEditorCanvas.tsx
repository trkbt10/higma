/**
 * @file Site editor graphical canvas.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EditorCanvas,
  type CanvasPageCoords,
  type EditorCanvasItemBounds,
} from "@higma-editor-surfaces/controls/canvas";
import {
  createFigFamilyDocumentResources,
  FigFamilyPageRendererFromResources,
} from "@higma-figma-runtime/react-renderer";
import type { ZoomMode } from "@higma-editor-surfaces/controls/zoom";
import { colorTokens } from "@higma-editor-kernel/ui/design-tokens";

import { useSiteEditor } from "../context/SiteEditorContext";
import { getSiteRolePresentation } from "../domain/site-role-presentation";
import type { SiteEditableUnit } from "../site-editor-workspace";
import type { SiteCanvasRegion } from "../domain/site-breakpoint-view";

type CanvasExtents = {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
};

const CANVAS_PADDING = 160;
const MIN_CANVAS_SIZE = 320;
const INITIAL_SITE_CANVAS_ZOOM: ZoomMode = 0.5;
const INITIAL_SITE_CANVAS_MARGIN = 36;

function createRegionExtents(regions: readonly SiteCanvasRegion[]): CanvasExtents {
  if (regions.length === 0) {
    throw new Error("Site editor canvas requires at least one canvas region");
  }
  const minX = Math.min(...regions.map((region) => region.x));
  const minY = Math.min(...regions.map((region) => region.y));
  const maxX = Math.max(...regions.map((region) => region.x + region.width));
  const maxY = Math.max(...regions.map((region) => region.y + region.height));
  const originX = minX - CANVAS_PADDING / 2;
  const originY = minY - CANVAS_PADDING / 2;
  return {
    width: Math.max(maxX - minX + CANVAS_PADDING, MIN_CANVAS_SIZE),
    height: Math.max(maxY - minY + CANVAS_PADDING, MIN_CANVAS_SIZE),
    offsetX: -originX,
    offsetY: -originY,
  };
}

function readActiveRegion(regions: readonly SiteCanvasRegion[]): SiteCanvasRegion {
  const region = regions[0];
  if (!region) {
    throw new Error("Site editor canvas requires an active canvas region");
  }
  if (regions.length !== 1) {
    throw new Error("Site editor canvas requires a single active site surface region");
  }
  return region;
}

function createLocalRulerCoordinateOffset(
  activeRegion: SiteCanvasRegion,
  extents: CanvasExtents,
): { readonly x: number; readonly y: number } {
  return {
    x: -activeRegion.x - extents.offsetX,
    y: -activeRegion.y - extents.offsetY,
  };
}

function shiftBoundsForCanvas(
  bounds: readonly EditorCanvasItemBounds[],
  extents: CanvasExtents,
): readonly EditorCanvasItemBounds[] {
  return bounds.map((item) => ({
    ...item,
    x: item.x + extents.offsetX,
    y: item.y + extents.offsetY,
  }));
}

function toWorldCoords(
  coords: CanvasPageCoords,
  extents: CanvasExtents,
): { readonly pageX: number; readonly pageY: number } {
  return {
    pageX: coords.pageX - extents.offsetX,
    pageY: coords.pageY - extents.offsetY,
  };
}

function findEditableUnit(units: readonly SiteEditableUnit[], unitId: string): SiteEditableUnit {
  const unit = units.find((item) => item.id === unitId);
  if (!unit) {
    throw new Error(`SiteEditorCanvas could not find editable unit ${unitId}`);
  }
  return unit;
}

function createCanvasItemLabel(units: readonly SiteEditableUnit[], unitId: string): string {
  const unit = findEditableUnit(units, unitId);
  return `Canvas item ${unit.label}`;
}

function renderCanvasBackground(size: { readonly width: number; readonly height: number; readonly scale: number }): ReactNode {
  return (
    <rect
      x={0}
      y={0}
      width={size.width}
      height={size.height}
      fill={colorTokens.background.primary}
      stroke={colorTokens.border.primary}
      strokeWidth={1 / size.scale}
    />
  );
}

function renderUnitOutline(unit: SiteEditableUnit, bounds: EditorCanvasItemBounds): ReactNode {
  const role = getSiteRolePresentation(unit.role);
  return (
    <g key={unit.id} pointerEvents="none">
      <rect
        x={bounds.x}
        y={bounds.y}
        width={Math.max(bounds.width, 1)}
        height={Math.max(bounds.height, 1)}
        rx={2}
        fill="none"
        stroke={role.accentColor}
        strokeWidth={1.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function renderUnitOutlines(units: readonly SiteEditableUnit[], bounds: readonly EditorCanvasItemBounds[]): readonly ReactNode[] {
  return bounds.map((itemBounds) => renderUnitOutline(findEditableUnit(units, itemBounds.id), itemBounds));
}

function renderActiveRegionClip(regions: readonly SiteCanvasRegion[], extents: CanvasExtents): ReactNode {
  return (
    <clipPath id="site-active-breakpoint-clip">
      {regions.map((region) => (
        <rect
          key={`${region.x}:${region.y}:${region.width}:${region.height}`}
          x={region.x + extents.offsetX}
          y={region.y + extents.offsetY}
          width={region.width}
          height={region.height}
        />
      ))}
    </clipPath>
  );
}

/** Render and edit site units on the shared graphical editor canvas. */
export function SiteEditorCanvas() {
  const {
    editableUnits,
    figRenderSurface,
    unitBounds,
    unitMoves,
    canvasRegions,
    unitSelection,
    selectedUnitId,
    activeSurfaceId,
    activeBreakpointName,
    beginMoveUnit,
    moveActiveUnit,
    endActiveUnitMove,
    setSelectedUnitId,
  } = useSiteEditor();
  const [zoomMode, setZoomMode] = useState<ZoomMode>(INITIAL_SITE_CANVAS_ZOOM);
  useEffect(() => {
    setZoomMode(INITIAL_SITE_CANVAS_ZOOM);
  }, [activeSurfaceId, activeBreakpointName]);
  const extents = useMemo(() => createRegionExtents(canvasRegions), [canvasRegions]);
  const activeRegion = useMemo(() => readActiveRegion(canvasRegions), [canvasRegions]);
  const rulerCoordinateOffset = useMemo(
    () => createLocalRulerCoordinateOffset(activeRegion, extents),
    [activeRegion, extents],
  );
  const canvasUnitBounds = useMemo(() => shiftBoundsForCanvas(unitBounds, extents), [unitBounds, extents]);
  const unitOutlines = useMemo(
    () => renderUnitOutlines(editableUnits, canvasUnitBounds),
    [editableUnits, canvasUnitBounds],
  );
  const clipPath = useMemo(() => renderActiveRegionClip(canvasRegions, extents), [canvasRegions, extents]);
  const getItemAriaLabel = useMemo(
    () => (unitId: string) => createCanvasItemLabel(editableUnits, unitId),
    [editableUnits],
  );
  const figSurface = figRenderSurface;
  const figResources = useMemo(() => createFigFamilyDocumentResources(figSurface.context), [figSurface.context]);
  const renderRevision = useMemo(
    () => unitMoves.map((move) => `${move.unitId}:${move.deltaX}:${move.deltaY}`).join("|"),
    [unitMoves],
  );

  return (
    <EditorCanvas
      key={`${activeSurfaceId}:${activeBreakpointName ?? "site"}`}
      canvasWidth={extents.width}
      canvasHeight={extents.height}
      zoomMode={zoomMode}
      onZoomModeChange={setZoomMode}
      initialViewportPlacement="top"
      initialViewportMargin={INITIAL_SITE_CANVAS_MARGIN}
      showRulers
      rulerCoordinateMode="unbounded"
      rulerCoordinateOffset={rulerCoordinateOffset}
      itemBounds={canvasUnitBounds}
      getItemAriaLabel={getItemAriaLabel}
      selectedIds={unitSelection.selectedIds}
      primaryId={selectedUnitId}
      canvasBackground={renderCanvasBackground}
      onItemPointerDown={(unitId: string, coords: CanvasPageCoords) => {
        const world = toWorldCoords(coords, extents);
        beginMoveUnit(unitId, world.pageX, world.pageY);
      }}
      onItemClick={(unitId: string) => setSelectedUnitId(unitId)}
      onItemDragMove={(coords: CanvasPageCoords) => {
        const world = toWorldCoords(coords, extents);
        moveActiveUnit(world.pageX, world.pageY);
      }}
      onItemDragEnd={(coords: CanvasPageCoords) => {
        const world = toWorldCoords(coords, extents);
        endActiveUnitMove(world.pageX, world.pageY);
      }}
      onCanvasClick={() => undefined}
    >
      <defs>{clipPath}</defs>
      <g clipPath="url(#site-active-breakpoint-clip)">
        <FigFamilyPageRendererFromResources
          key={renderRevision}
          page={figSurface.page}
          nodes={figSurface.nodes}
          canvasWidth={extents.width}
          canvasHeight={extents.height}
          resources={figResources}
          renderOptions={figSurface.renderOptions}
          viewportX={-extents.offsetX}
          viewportY={-extents.offsetY}
          viewportWidth={extents.width}
          viewportHeight={extents.height}
        />
      </g>
      <g>{unitOutlines}</g>
    </EditorCanvas>
  );
}
