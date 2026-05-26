/** @file Canvas viewport accessors for the Fig editor operation surface. */
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import type {
  FigEditorCanvasNodeBoundsSnapshot,
  FigEditorCanvasViewportSnapshot,
  FigEditorContextValue,
} from "../context/FigEditorContext";
import {
  findDeepestBoundsAtPoint,
} from "../canvas/interaction/rendered-node-bounds";
import { resolveViewportRenderRegion } from "../canvas/layout/viewport-render-region";
import type { SelectNodeOptions } from "../context/FigEditorContext";
import { translateFigEditorSelectedNodeDragBoundsList } from "../context/fig-editor-selected-node-drag-bounds";
import { requireFigEditorOperationSurfaceFiniteNumber } from "./fig-editor-operation-surface-guid";
import {
  figEditorOperationSurfaceFindNodesByQuery,
  figEditorOperationSurfaceNodeSnapshot,
  figEditorOperationSurfaceResolveSelectorGuid,
} from "./fig-editor-operation-surface-node-access";
import type {
  FigEditorOperationSurfaceCanvasHitSnapshot,
  FigEditorOperationSurfaceNodeBoundsSnapshot,
  FigEditorOperationSurfaceNodeQuery,
  FigEditorOperationSurfaceNodeRatio,
  FigEditorOperationSurfaceNodeSelector,
  FigEditorOperationSurfaceNodeViewportPoint,
  FigEditorOperationSurfaceViewportDelta,
  FigEditorOperationSurfaceViewportPoint,
} from "./fig-editor-operation-surface-types";

function requireFigEditorOperationSurfaceCanvasViewport(editor: FigEditorContextValue) {
  const viewport = editor.canvasViewport;
  if (viewport === undefined) {
    throw new Error("Fig editor operation surface canvas viewport is not published");
  }
  return viewport;
}

function requireCanvasRenderedNodeBounds(
  editor: FigEditorContextValue,
): readonly FigEditorCanvasNodeBoundsSnapshot[] {
  const viewport = requireFigEditorOperationSurfaceCanvasViewport(editor);
  return viewport.renderedNodeBounds;
}

function requireCanvasVisibleNodeBounds(
  editor: FigEditorContextValue,
): readonly FigEditorCanvasNodeBoundsSnapshot[] {
  const viewport = requireFigEditorOperationSurfaceCanvasViewport(editor);
  return viewport.visibleNodeBounds;
}

function requireCanvasNodeBounds(
  editor: FigEditorContextValue,
  guid: FigGuid,
  owner: string,
): FigEditorCanvasNodeBoundsSnapshot {
  const guidKey = guidToString(guid);
  const bounds = renderedCanvasNodeBounds(editor).find((candidate) => candidate.id === guidKey);
  if (bounds === undefined) {
    throw new Error(`${owner}: Kiwi node ${guidKey} is not rendered under the active CANVAS`);
  }
  return bounds;
}

function snapshotNodeBounds(bounds: FigEditorCanvasNodeBoundsSnapshot): FigEditorOperationSurfaceNodeBoundsSnapshot {
  return {
    guidKey: bounds.id,
    rootGuidKey: bounds.rootId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
    aabb: {
      x: bounds.aabb.x,
      y: bounds.aabb.y,
      width: bounds.aabb.width,
      height: bounds.aabb.height,
    },
  };
}

function renderedCanvasNodeBounds(editor: FigEditorContextValue): readonly FigEditorCanvasNodeBoundsSnapshot[] {
  const bounds = requireCanvasRenderedNodeBounds(editor);
  const dragTransform = editor.selectedFigNodeDragTransform;
  if (dragTransform === null) {
    return bounds;
  }
  return translateFigEditorSelectedNodeDragBoundsList(editor.context.document.nodesByGuid, bounds, {
    draggedGuidKey: guidToString(dragTransform.guid),
    dx: dragTransform.dx,
    dy: dragTransform.dy,
  });
}

function visibleCanvasNodeBounds(editor: FigEditorContextValue): readonly FigEditorCanvasNodeBoundsSnapshot[] {
  const bounds = requireCanvasVisibleNodeBounds(editor);
  const dragTransform = editor.selectedFigNodeDragTransform;
  if (dragTransform === null) {
    return bounds;
  }
  return translateFigEditorSelectedNodeDragBoundsList(editor.context.document.nodesByGuid, bounds, {
    draggedGuidKey: guidToString(dragTransform.guid),
    dx: dragTransform.dx,
    dy: dragTransform.dy,
  });
}

function visibleCanvasNodeGuidKeySet(
  editor: FigEditorContextValue,
  query: FigEditorOperationSurfaceNodeQuery | undefined,
): ReadonlySet<string> | undefined {
  if (query === undefined) {
    return undefined;
  }
  return new Set(figEditorOperationSurfaceFindNodesByQuery(editor, query).map((node) => {
    if (node.guid === undefined) {
      throw new Error("canvas.visibleNodeBounds query matched a Kiwi node without guid");
    }
    return guidToString(node.guid);
  }));
}

function rotatePointAroundCenter(
  point: { readonly x: number; readonly y: number },
  bounds: FigEditorCanvasNodeBoundsSnapshot,
): { readonly x: number; readonly y: number } {
  if (bounds.rotation === 0) {
    return point;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radians = bounds.rotation * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}

function nodePagePointFromRatio(
  bounds: FigEditorCanvasNodeBoundsSnapshot,
  ratio: FigEditorOperationSurfaceNodeRatio,
): { readonly x: number; readonly y: number } {
  const ratioX = requireFigEditorOperationSurfaceFiniteNumber(ratio.x, "canvas.nodeViewportPoint ratio.x");
  const ratioY = requireFigEditorOperationSurfaceFiniteNumber(ratio.y, "canvas.nodeViewportPoint ratio.y");
  const unrotated = {
    x: bounds.x + bounds.width * ratioX,
    y: bounds.y + bounds.height * ratioY,
  };
  return rotatePointAroundCenter(unrotated, bounds);
}

function pagePointFromViewportPoint(
  editor: FigEditorContextValue,
  point: FigEditorOperationSurfaceViewportPoint,
): { readonly pageX: number; readonly pageY: number; readonly viewportX: number; readonly viewportY: number } {
  const viewport = requireFigEditorOperationSurfaceCanvasViewport(editor);
  const renderRegion = resolveViewportRenderRegion({ context: viewport });
  if (renderRegion === null) {
    throw new Error("canvas.hitTestViewportPoint requires a positive editor canvas viewport");
  }
  const viewportX = requireFigEditorOperationSurfaceFiniteNumber(point.viewportX, "canvas.hitTestViewportPoint viewportX");
  const viewportY = requireFigEditorOperationSurfaceFiniteNumber(point.viewportY, "canvas.hitTestViewportPoint viewportY");
  return {
    pageX: renderRegion.x + viewportX / viewport.viewport.scale,
    pageY: renderRegion.y + viewportY / viewport.viewport.scale,
    viewportX,
    viewportY,
  };
}

function requirePositiveViewportScale(editor: FigEditorContextValue, owner: string): number {
  const viewport = requireFigEditorOperationSurfaceCanvasViewport(editor);
  const scale = requireFigEditorOperationSurfaceFiniteNumber(viewport.viewport.scale, `${owner} viewport scale`);
  if (scale <= 0) {
    throw new Error(`${owner} requires a positive editor viewport scale`);
  }
  return scale;
}

/** Convert a viewport-pixel delta into a Kiwi page-coordinate delta. */
export function figEditorOperationSurfaceCanvasPageDeltaFromViewportDelta(
  editor: FigEditorContextValue,
  delta: FigEditorOperationSurfaceViewportDelta,
  owner: string,
): { readonly dx: number; readonly dy: number } {
  const scale = requirePositiveViewportScale(editor, owner);
  const viewportDx = requireFigEditorOperationSurfaceFiniteNumber(delta.viewportDx, `${owner} viewportDx`);
  const viewportDy = requireFigEditorOperationSurfaceFiniteNumber(delta.viewportDy, `${owner} viewportDy`);
  return {
    dx: viewportDx / scale,
    dy: viewportDy / scale,
  };
}

function canvasHitSnapshot(
  editor: FigEditorContextValue,
  point: ReturnType<typeof pagePointFromViewportPoint>,
  bounds: FigEditorCanvasNodeBoundsSnapshot,
): FigEditorOperationSurfaceCanvasHitSnapshot {
  const node = editor.context.document.nodesByGuid.get(bounds.id);
  if (node === undefined) {
    throw new Error(`canvas.hitTestViewportPoint: Kiwi node ${bounds.id} is not present`);
  }
  return {
    point,
    bounds: snapshotNodeBounds(bounds),
    node: figEditorOperationSurfaceNodeSnapshot(editor, node),
  };
}

/** Snapshot one visible Kiwi node's editor canvas bounds. */
export function figEditorOperationSurfaceCanvasNodeBounds(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
): FigEditorOperationSurfaceNodeBoundsSnapshot {
  const guid = figEditorOperationSurfaceResolveSelectorGuid(editor, selector, "canvas.nodeBounds");
  return snapshotNodeBounds(requireCanvasNodeBounds(editor, guid, "canvas.nodeBounds"));
}

/** Snapshot all visible renderer-derived node bounds under the active CANVAS. */
export function figEditorOperationSurfaceCanvasVisibleNodeBounds(
  editor: FigEditorContextValue,
  query: FigEditorOperationSurfaceNodeQuery | undefined,
): readonly FigEditorOperationSurfaceNodeBoundsSnapshot[] {
  const acceptedGuidKeys = visibleCanvasNodeGuidKeySet(editor, query);
  return visibleCanvasNodeBounds(editor)
    .filter((bounds) => acceptedGuidKeys === undefined || acceptedGuidKeys.has(bounds.id))
    .map(snapshotNodeBounds);
}

/** Project one Kiwi node-relative ratio into the current WebGL/SVG viewport surface. */
export function figEditorOperationSurfaceCanvasNodeViewportPoint(
  editor: FigEditorContextValue,
  selector: FigEditorOperationSurfaceNodeSelector,
  ratio: FigEditorOperationSurfaceNodeRatio,
): FigEditorOperationSurfaceNodeViewportPoint {
  const viewport = requireFigEditorOperationSurfaceCanvasViewport(editor);
  const renderRegion = resolveViewportRenderRegion({ context: viewport });
  if (renderRegion === null) {
    throw new Error("canvas.nodeViewportPoint requires a positive editor canvas viewport");
  }
  const guid = figEditorOperationSurfaceResolveSelectorGuid(editor, selector, "canvas.nodeViewportPoint");
  const bounds = requireCanvasNodeBounds(editor, guid, "canvas.nodeViewportPoint");
  const point = nodePagePointFromRatio(bounds, ratio);
  return {
    guidKey: guidToString(guid),
    pageX: point.x,
    pageY: point.y,
    viewportX: (point.x - renderRegion.x) * viewport.viewport.scale,
    viewportY: (point.y - renderRegion.y) * viewport.viewport.scale,
  };
}

/** Resolve the topmost visible Kiwi node at a viewport point without reading the DOM. */
export function figEditorOperationSurfaceCanvasHitTestViewportPoint(
  editor: FigEditorContextValue,
  point: FigEditorOperationSurfaceViewportPoint,
): FigEditorOperationSurfaceCanvasHitSnapshot | undefined {
  const pagePoint = pagePointFromViewportPoint(editor, point);
  const bounds = findDeepestBoundsAtPoint(visibleCanvasNodeBounds(editor), {
    x: pagePoint.pageX,
    y: pagePoint.pageY,
  });
  if (bounds === undefined) {
    return undefined;
  }
  return canvasHitSnapshot(editor, pagePoint, bounds);
}

/** Require the topmost visible Kiwi node at a viewport point without reading the DOM. */
export function figEditorOperationSurfaceCanvasRequireHitTestViewportPoint(
  editor: FigEditorContextValue,
  point: FigEditorOperationSurfaceViewportPoint,
): FigEditorOperationSurfaceCanvasHitSnapshot {
  const hit = figEditorOperationSurfaceCanvasHitTestViewportPoint(editor, point);
  if (hit === undefined) {
    throw new Error("canvas.requireHitTestViewportPoint did not hit a visible Kiwi node");
  }
  return hit;
}

/** Select the topmost visible Kiwi node at a viewport point without reading the DOM. */
export function figEditorOperationSurfaceCanvasSelectNodeAtViewportPoint(
  editor: FigEditorContextValue,
  point: FigEditorOperationSurfaceViewportPoint,
  options: SelectNodeOptions | undefined,
): FigEditorOperationSurfaceCanvasHitSnapshot | undefined {
  const hit = figEditorOperationSurfaceCanvasHitTestViewportPoint(editor, point);
  if (hit === undefined) {
    return undefined;
  }
  editor.selectNodeGuid(hit.node.guid, options);
  return hit;
}

/** Require and select the topmost visible Kiwi node at a viewport point. */
export function figEditorOperationSurfaceCanvasRequireSelectNodeAtViewportPoint(
  editor: FigEditorContextValue,
  point: FigEditorOperationSurfaceViewportPoint,
  options: SelectNodeOptions | undefined,
): FigEditorOperationSurfaceCanvasHitSnapshot {
  const hit = figEditorOperationSurfaceCanvasSelectNodeAtViewportPoint(editor, point, options);
  if (hit === undefined) {
    throw new Error("canvas.requireSelectNodeAtViewportPoint did not hit a visible Kiwi node");
  }
  return hit;
}

/** Read the current editor canvas viewport snapshot. */
export function figEditorOperationSurfaceCanvasViewport(
  editor: FigEditorContextValue,
): FigEditorCanvasViewportSnapshot {
  return structuredClone(requireFigEditorOperationSurfaceCanvasViewport(editor));
}
