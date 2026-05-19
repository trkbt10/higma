/**
 * @file Interactive canvas surface for the Kiwi-backed Fig editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  EditorCanvas,
  type CanvasPageCoords,
  type EditorCanvasHandle,
  type EditorCanvasViewportContentContext,
} from "@higma-editor-surfaces/controls/canvas";
import { ContextMenu, type MenuEntry } from "@higma-editor-kernel/ui/context-menu";
import type { ZoomMode } from "@higma-editor-surfaces/controls/zoom";
import { createFigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import type { TextFontResolver } from "@higma-document-renderers/fig/text";
import type { BooleanOperationType } from "@higma-primitives/path";
import type { FigGuid, FigNode, FigPaint } from "@higma-document-models/fig/types";
import { PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { NodeSpec } from "@higma-document-io/fig/types";
import { useFigEditor, type FigCreationMode } from "../context/FigEditorContext";
import { translateTransform } from "../context/fig-editor/matrix";
import { FigPageRenderer } from "./rendering/FigPageRenderer";
import type { FigEditorRendererKind } from "./rendering/renderer-kind";
import { flattenAllNodeBounds } from "./interaction/bounds";
import {
  canvasIdsFromGuids,
  resolveNodeGuidFromCanvasId,
  resolveSelectableMarqueeGuids,
} from "./interaction/selection-resolution";
import { resolveInteractionTargetGuid } from "./interaction/target-resolution";
import { resolveCanvasInteractionPolicy } from "./interaction/interaction-policy";
import { exceedsThreshold } from "./interaction/drag-threshold";
import { useFigKeyboard } from "./interaction/use-fig-keyboard";
import { computeCanvasBoundsFromNodeBounds } from "./layout/canvas-bounds";
import { resolveViewportRenderWindow } from "./layout/viewport-render-window";
import { FigTextEditOverlay } from "../text-edit/FigTextEditOverlay";
import {
  addVectorPathPoint,
  collectEditableVectorPathOverlays,
  collectVectorPathControlLines,
  collectVectorPathHandles,
  getVectorHandleAriaLabel,
  resolveEditableVectorPaths,
  updateVectorPathWithOperation,
  type VectorPathHandle,
} from "../vector-path/editor-model";
import {
  applyVectorPathDraftOperation,
  commitVectorPathDraftToNodeSpec,
  getVectorPathDraftControlLines,
  getVectorPathDraftHandleCursor,
  getVectorPathDraftHandles,
  resolveVectorPathDraftHandleIntent,
  vectorPathDraftToPreviewPath,
  type VectorPathDraftHandle,
  type VectorPathDraftOperationResult,
  type VectorPathDraftParent,
  type VectorPathDraftSession,
} from "../vector-path/draft";
import { getVectorPathDraftHandleLabel } from "../vector-path/draft-labels";
import {
  getVectorPathHandleCursor,
  orderVectorPathHandlesForHitTesting,
  screenPxToPagePx,
  VECTOR_PATH_OVERLAY_STYLE,
} from "../vector-path/overlay-style";

export type FigEditorViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type FigEditorCanvasProps = {
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly viewport?: FigEditorViewport;
  readonly renderer?: FigEditorRendererKind;
  readonly textFontResolver?: TextFontResolver;
  readonly children?: ReactNode;
  readonly style?: CSSProperties;
  readonly webglInitializationDelayMs?: number;
};

type MoveSession = {
  readonly guid: FigGuid;
  readonly startX: number;
  readonly startY: number;
};

type CreationDragSession = {
  readonly startX: number;
  readonly startY: number;
};

type VectorPathDraftHandleDrag = {
  readonly handle: VectorPathDraftHandle;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly moved: boolean;
};

type ContextMenuState = {
  readonly kind: "boolean";
  readonly x: number;
  readonly y: number;
} | {
  readonly kind: "vector";
  readonly x: number;
  readonly y: number;
  readonly handle: VectorPathHandle;
} | null;

const INITIAL_ZOOM_MODE: ZoomMode = "fit";
const INITIAL_VIEWPORT_MARGIN = 48;
const VECTOR_PATH_POINTER_DRAG_THRESHOLD_PX = 3;
const VECTOR_PATH_CLOSE_TOLERANCE_PX = 8;
const ACTIVE_PAGE_VECTOR_PATH_DRAFT_PARENT: VectorPathDraftParent = {
  parentId: null,
  parentTransform: undefined,
};
const SOLID_BLUE: FigPaint = {
  type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
  color: { r: 0.16, g: 0.36, b: 0.88, a: 1 },
  opacity: 1,
  visible: true,
};
const SOLID_WHITE: FigPaint = {
  type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
  color: { r: 1, g: 1, b: 1, a: 1 },
  opacity: 1,
  visible: true,
};
const TEXT_FILL: FigPaint = {
  type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
  color: { r: 0.1, g: 0.1, b: 0.12, a: 1 },
  opacity: 1,
  visible: true,
};
const canvasHostStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
};

const BOOLEAN_CONTEXT_MENU_ITEMS: readonly MenuEntry[] = [
  { id: "boolean-union", label: "Union Selection" },
  { id: "boolean-subtract", label: "Subtract Selection" },
  { id: "boolean-intersect", label: "Intersect Selection" },
  { id: "boolean-exclude", label: "Exclude Selection" },
];

const VECTOR_CONTEXT_MENU_ITEMS: readonly MenuEntry[] = [
  { id: "convert-vector-point-curve", label: "Convert Segment to Curve" },
  { id: "convert-vector-point-line", label: "Convert Segment to Line" },
  { id: "delete-vector-point", label: "Delete Vector Point", danger: true },
  { id: "open-vector-path", label: "Open Vector Path" },
  { id: "close-vector-path", label: "Close Vector Path" },
];

function worldPoint(coords: CanvasPageCoords): { readonly x: number; readonly y: number } {
  return {
    x: coords.pageX,
    y: coords.pageY,
  };
}

function dragRect(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function nodeSpecForCreation(
  mode: FigCreationMode,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): NodeSpec {
  if (rect.width <= 0 || (mode !== "line" && rect.height <= 0)) {
    throw new Error("nodeSpecForCreation requires a non-zero drag rectangle");
  }
  switch (mode) {
    case "frame":
      return {
        type: "FRAME",
        name: "Frame",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fills: [SOLID_WHITE],
        clipsContent: true,
      };
    case "rectangle":
      return {
        type: "ROUNDED_RECTANGLE",
        name: "Rectangle",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fills: [SOLID_BLUE],
      };
    case "ellipse":
      return {
        type: "ELLIPSE",
        name: "Ellipse",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fills: [SOLID_BLUE],
      };
    case "line":
      return {
        type: "LINE",
        name: "Line",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: 0,
        strokes: [SOLID_BLUE],
        strokeWeight: 2,
      };
    case "star":
      return {
        type: "STAR",
        name: "Star",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pointCount: 5,
        fills: [SOLID_BLUE],
      };
    case "polygon":
      return {
        type: "REGULAR_POLYGON",
        name: "Polygon",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pointCount: 6,
        fills: [SOLID_BLUE],
      };
    case "text":
      return {
        type: "TEXT",
        name: "Text",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        characters: "Text",
        fontFamily: "Inter",
        fontStyle: "Regular",
        fontSize: 16,
        lineHeight: 24,
        fills: [TEXT_FILL],
      };
    default:
      throw new Error(`Unsupported Fig creation mode ${mode}`);
  }
}

function createItemLabel(contextNodes: ReadonlyMap<string, FigNode>, id: string): string {
  const node = contextNodes.get(id);
  if (node === undefined) {
    throw new Error(`FigEditorCanvas: item ${id} is not present in the Kiwi document`);
  }
  return `Canvas node ${id}`;
}

function svgElementPoint(
  element: SVGGraphicsElement,
  clientX: number,
  clientY: number,
): { readonly x: number; readonly y: number } {
  const svg = element.ownerSVGElement;
  if (svg === null) {
    throw new Error("FigEditorCanvas vector overlay requires an owner SVG element");
  }
  const matrix = element.getScreenCTM();
  if (matrix === null) {
    throw new Error("FigEditorCanvas vector overlay requires a screen CTM");
  }
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(matrix.inverse());
  return { x: local.x, y: local.y };
}

function requirePagePointFromScreen(
  canvas: EditorCanvasHandle | null,
  event: Pick<PointerEvent, "clientX" | "clientY">,
): { readonly x: number; readonly y: number } {
  if (canvas === null) {
    throw new Error("FigEditorCanvas vector path draft requires an editor canvas ref");
  }
  const page = canvas.screenToPage(event.clientX, event.clientY);
  if (page === undefined) {
    throw new Error("FigEditorCanvas vector path draft requires page coordinates");
  }
  return { x: page.pageX, y: page.pageY };
}

function canEditKiwiNodePath(node: FigNode | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  return resolveEditableVectorPaths(node) !== undefined;
}

/**
 * Render the active Kiwi CANVAS page through the shared editor canvas.
 */
export function FigEditorCanvas({
  canvasWidth,
  canvasHeight,
  renderer = "svg",
  textFontResolver,
  children,
  style,
  webglInitializationDelayMs,
}: FigEditorCanvasProps) {
  const {
    context,
    resources,
    activePage,
    selectedGuids,
    creationMode,
    textEdit,
    canUndo,
    canRedo,
    selectNodeGuid,
    setSelectedGuids,
    clearSelection,
    setCreationMode,
    enterTextEdit,
    exitTextEdit,
    beginCanvasTransform,
    endCanvasTransform,
    updateNode,
    addNodeToActivePage,
    createBooleanOperationFromSelection,
    deleteSelectedNodes,
    undo,
    redo,
  } = useFigEditor();
  if (activePage === undefined) {
    throw new Error("FigEditorCanvas requires a CANVAS node in the Kiwi document");
  }

  const pageChildren = useMemo(() => resources.childrenOf(activePage), [activePage, resources]);
  const worldBounds = useMemo(
    () => flattenAllNodeBounds(context.document, pageChildren),
    [context.document, pageChildren],
  );
  const extents = useMemo(() => {
    const computed = computeCanvasBoundsFromNodeBounds(worldBounds);
    return {
      ...computed,
      width: canvasWidth ?? computed.width,
      height: canvasHeight ?? computed.height,
    };
  }, [canvasHeight, canvasWidth, worldBounds]);
  const itemBounds = worldBounds;
  const selectedIds = useMemo(() => canvasIdsFromGuids(selectedGuids), [selectedGuids]);
  const primaryId = selectedIds[0];
  const [zoomMode, setZoomMode] = useState<ZoomMode>(INITIAL_ZOOM_MODE);
  const [viewportRenderContext, setViewportRenderContext] = useState<EditorCanvasViewportContentContext | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const viewportScale = viewportRenderContext?.viewport.scale ?? 1;
  const renderWindow = useMemo(
    () => resolveViewportRenderWindow({ context: viewportRenderContext }),
    [viewportRenderContext],
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [vectorPathDraftSession, setVectorPathDraftSession] = useState<VectorPathDraftSession | null>(null);
  const canvasRef = useRef<EditorCanvasHandle>(null);
  const moveSessionRef = useRef<MoveSession | null>(null);
  const creationDragSessionRef = useRef<CreationDragSession | null>(null);
  const vectorPathDragRef = useRef<VectorPathHandle | null>(null);
  const vectorPathDraftSessionRef = useRef<VectorPathDraftSession | null>(null);
  const vectorPathDraftHandleDragRef = useRef<VectorPathDraftHandleDrag | null>(null);
  const previousPathEditingEnabledRef = useRef(false);
  const policy = useMemo(() => resolveCanvasInteractionPolicy(creationMode), [creationMode]);
  const primaryNode = useMemo(() => {
    if (primaryId === undefined) {
      return undefined;
    }
    return context.document.nodesByGuid.get(primaryId);
  }, [context.document.nodesByGuid, primaryId]);
  const primaryBounds = useMemo(() => {
    if (primaryId === undefined) {
      return undefined;
    }
    return itemBounds.find((item) => item.id === primaryId);
  }, [itemBounds, primaryId]);
  const primaryEditableVectorPaths = useMemo(
    () => policy.canEditPath ? resolveEditableVectorPaths(primaryNode) : undefined,
    [policy.canEditPath, primaryNode],
  );
  const vectorPathHandles = useMemo(
    () => collectVectorPathHandles(primaryNode, activePage, primaryEditableVectorPaths),
    [activePage, primaryEditableVectorPaths, primaryNode],
  );
  const vectorPathControlLines = useMemo(
    () => collectVectorPathControlLines(primaryNode, activePage, primaryEditableVectorPaths),
    [activePage, primaryEditableVectorPaths, primaryNode],
  );
  const editableVectorPathOverlays = useMemo(
    () => collectEditableVectorPathOverlays(primaryNode, activePage, primaryEditableVectorPaths),
    [activePage, primaryEditableVectorPaths, primaryNode],
  );
  const contextMenuItems = useMemo(() => {
    if (contextMenu?.kind === "vector") {
      return VECTOR_CONTEXT_MENU_ITEMS;
    }
    const disabled = selectedGuids.length < 2;
    return BOOLEAN_CONTEXT_MENU_ITEMS.map((item) => {
      if (item.type === "separator") {
        return item;
      }
      return { ...item, disabled };
    });
  }, [contextMenu?.kind, selectedGuids.length]);

  const publishVectorPathDraftResult = useCallback((
    result: VectorPathDraftOperationResult,
    nextModeAfterCommit: FigCreationMode | undefined,
  ): void => {
    vectorPathDraftSessionRef.current = result.session;
    setVectorPathDraftSession(result.session);
    if (result.committedDraft === undefined) {
      return;
    }
    const spec = commitVectorPathDraftToNodeSpec(result.committedDraft);
    addNodeToActivePage(spec, result.committedDraft.parentId, "canvas");
    if (nextModeAfterCommit !== undefined) {
      setCreationMode(nextModeAfterCommit);
    }
  }, [addNodeToActivePage, setCreationMode]);

  const commitVectorPathDraft = useCallback((nextMode: FigCreationMode): void => {
    publishVectorPathDraftResult(
      applyVectorPathDraftOperation(vectorPathDraftSessionRef.current, { type: "commit" }),
      nextMode,
    );
  }, [publishVectorPathDraftResult]);

  const placeVectorPathDraftPoint = useCallback((
    coords: CanvasPageCoords,
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ): void => {
    const point = worldPoint(coords);
    publishVectorPathDraftResult(
      applyVectorPathDraftOperation(vectorPathDraftSessionRef.current, {
        type: "place-point",
        parent: ACTIVE_PAGE_VECTOR_PATH_DRAFT_PARENT,
        localPoint: point,
        pagePoint: point,
        pointerStart: { clientX: event.clientX, clientY: event.clientY },
        closeTolerance: screenPxToPagePx(VECTOR_PATH_CLOSE_TOLERANCE_PX, viewportScale),
      }),
      "pen",
    );
  }, [publishVectorPathDraftResult, viewportScale]);

  const pointFromPointerEvent = useCallback((event: Pick<PointerEvent, "clientX" | "clientY">) => {
    return requirePagePointFromScreen(canvasRef.current, event);
  }, []);

  useFigKeyboard({
    hasSelection: selectedGuids.length > 0,
    setCreationMode,
    clearSelection,
    deleteSelection: () => deleteSelectedNodes("canvas"),
    vectorPathDraftActive: vectorPathDraftSession !== null,
    commitVectorPathDraft,
    canUndo,
    canRedo,
    undo,
    redo,
    isTextEditing: textEdit.type === "active",
    exitTextEdit,
  });

  const handleViewportChange = useCallback((
    _viewport: EditorCanvasViewportContentContext["viewport"],
    nextContext: EditorCanvasViewportContentContext,
  ): void => {
    setViewportRenderContext((previous) => {
      if (
        previous !== null
        && previous.rulerThickness === nextContext.rulerThickness
        && previous.viewportSize.width === nextContext.viewportSize.width
        && previous.viewportSize.height === nextContext.viewportSize.height
        && previous.viewport.translateX === nextContext.viewport.translateX
        && previous.viewport.translateY === nextContext.viewport.translateY
        && previous.viewport.scale === nextContext.viewport.scale
      ) {
        return previous;
      }
      setViewportRevision((previousRevision) => previousRevision + 1);
      return nextContext;
    });
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const current = vectorPathDraftSessionRef.current;
      if (current === null) {
        return;
      }
      const handleDrag = vectorPathDraftHandleDragRef.current;
      const point = pointFromPointerEvent(event);
      const start = current.pointerStart;
      if (handleDrag === null && start !== undefined) {
        publishVectorPathDraftResult(applyVectorPathDraftOperation(current, {
          type: "anchor-drag-preview",
          localPoint: point,
          pagePoint: point,
          exceededThreshold: exceedsThreshold({
            startClientX: start.clientX,
            startClientY: start.clientY,
            clientX: event.clientX,
            clientY: event.clientY,
            thresholdPx: VECTOR_PATH_POINTER_DRAG_THRESHOLD_PX,
          }),
        }), undefined);
        return;
      }
      if (handleDrag === null) {
        publishVectorPathDraftResult(applyVectorPathDraftOperation(current, {
          type: "preview",
          pagePoint: point,
        }), undefined);
        return;
      }
      const intent = resolveVectorPathDraftHandleIntent({
        draft: current.draft,
        handle: handleDrag.handle,
        startClientX: handleDrag.startClientX,
        startClientY: handleDrag.startClientY,
        clientX: event.clientX,
        clientY: event.clientY,
        dragThresholdPx: VECTOR_PATH_POINTER_DRAG_THRESHOLD_PX,
      });
      if (intent !== "move-handle") {
        return;
      }
      vectorPathDraftHandleDragRef.current = { ...handleDrag, moved: true };
      publishVectorPathDraftResult(applyVectorPathDraftOperation(current, {
        type: "move-handle",
        handle: handleDrag.handle,
        localPoint: point,
        pagePoint: point,
      }), undefined);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      const current = vectorPathDraftSessionRef.current;
      const handleDrag = vectorPathDraftHandleDragRef.current;
      vectorPathDraftHandleDragRef.current = null;
      if (current === null) {
        return;
      }
      const start = current.pointerStart;
      if (handleDrag === null && start !== undefined) {
        const point = pointFromPointerEvent(event);
        publishVectorPathDraftResult(applyVectorPathDraftOperation(current, {
          type: "anchor-drag-end",
          localPoint: point,
          pagePoint: point,
          exceededThreshold: exceedsThreshold({
            startClientX: start.clientX,
            startClientY: start.clientY,
            clientX: event.clientX,
            clientY: event.clientY,
            thresholdPx: VECTOR_PATH_POINTER_DRAG_THRESHOLD_PX,
          }),
        }), undefined);
        return;
      }
      if (handleDrag === null) {
        return;
      }
      const intent = resolveVectorPathDraftHandleIntent({
        draft: current.draft,
        handle: handleDrag.handle,
        startClientX: handleDrag.startClientX,
        startClientY: handleDrag.startClientY,
        clientX: event.clientX,
        clientY: event.clientY,
        dragThresholdPx: VECTOR_PATH_POINTER_DRAG_THRESHOLD_PX,
      });
      if (intent === "close-start-anchor" && !handleDrag.moved) {
        publishVectorPathDraftResult(applyVectorPathDraftOperation(current, { type: "close-from-start-handle" }), "pen");
        return;
      }
      const point = pointFromPointerEvent(event);
      publishVectorPathDraftResult(applyVectorPathDraftOperation(current, {
        type: "move-handle",
        handle: handleDrag.handle,
        localPoint: point,
        pagePoint: point,
      }), undefined);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [pointFromPointerEvent, publishVectorPathDraftResult]);

  useEffect(() => {
    const wasPathEditingEnabled = previousPathEditingEnabledRef.current;
    previousPathEditingEnabledRef.current = policy.canEditPath;
    if (!wasPathEditingEnabled || policy.canEditPath || vectorPathDraftSessionRef.current === null) {
      return;
    }
    commitVectorPathDraft("select");
  }, [commitVectorPathDraft, policy.canEditPath]);

  const handleItemPointerDown = useCallback((id: string, coords: CanvasPageCoords, event: ReactPointerEvent): void => {
    if (textEdit.type === "active") {
      exitTextEdit();
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const point = worldPoint(coords);
    if (policy.canCreate) {
      creationDragSessionRef.current = { startX: point.x, startY: point.y };
      return;
    }
    const guid = resolveInteractionTargetGuid({
      document: context.document,
      itemBounds: worldBounds,
      hitId: id,
      point,
    });
    const node = context.document.nodesByGuid.get(guidToString(guid));
    const startsPathEdit = policy.canEditPath && vectorPathDraftSessionRef.current === null && canEditKiwiNodePath(node);
    if (startsPathEdit) {
      selectNodeGuid(guid, {
        additive: coords.addToSelection,
        toggle: coords.toggle,
      });
      return;
    }
    if (policy.canEditPath) {
      placeVectorPathDraftPoint(coords, event.nativeEvent);
      return;
    }
    if (!policy.canSelect && !policy.canMove) {
      return;
    }
    selectNodeGuid(guid, {
      additive: coords.addToSelection,
      toggle: coords.toggle,
    });
    if (policy.canMove) {
      moveSessionRef.current = { guid, startX: point.x, startY: point.y };
      beginCanvasTransform();
    }
  }, [
    beginCanvasTransform,
    context.document,
    exitTextEdit,
    policy.canCreate,
    policy.canMove,
    policy.canEditPath,
    policy.canSelect,
    placeVectorPathDraftPoint,
    selectNodeGuid,
    textEdit.type,
    worldBounds,
  ]);

  const handleItemClick = useCallback((id: string, coords: CanvasPageCoords): void => {
    if (!policy.canSelect) {
      return;
    }
    if (policy.canEditPath) {
      return;
    }
    if (coords.addToSelection || coords.toggle) {
      return;
    }
    selectNodeGuid(resolveNodeGuidFromCanvasId(context.document, id));
  }, [context.document, policy.canEditPath, policy.canSelect, selectNodeGuid]);

  const handleItemDoubleClick = useCallback((id: string, _coords: CanvasPageCoords): void => {
    if (!policy.canSelect || policy.canEditPath) {
      return;
    }
    const guid = resolveNodeGuidFromCanvasId(context.document, id);
    const node = context.document.nodesByGuid.get(guidToString(guid));
    if (node === undefined) {
      throw new Error(`FigEditorCanvas: node ${id} is not present for double-click`);
    }
    if (getNodeType(node) !== "TEXT") {
      return;
    }
    enterTextEdit(guid);
  }, [context.document, enterTextEdit, policy.canEditPath, policy.canSelect]);

  const handleItemContextMenu = useCallback((id: string, coords: CanvasPageCoords): void => {
    if (!policy.canSelect) {
      return;
    }
    const point = worldPoint(coords);
    const guid = resolveInteractionTargetGuid({
      document: context.document,
      itemBounds: worldBounds,
      hitId: id,
      point,
    });
    if (!selectedGuids.some((selected) => guidToString(selected) === guidToString(guid))) {
      selectNodeGuid(guid);
    }
    setContextMenu({ kind: "boolean", x: coords.clientX, y: coords.clientY });
  }, [context.document, policy.canSelect, selectNodeGuid, selectedGuids, worldBounds]);

  const closeContextMenu = useCallback((): void => {
    setContextMenu(null);
  }, []);

  const runContextMenuAction = useCallback((actionId: string): void => {
    if (contextMenu?.kind === "vector") {
      const handle = contextMenu.handle;
      switch (actionId) {
        case "convert-vector-point-curve":
          updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
            node,
            pathIndex: handle.pathIndex,
            operation: { type: "convert-segment-to-curve", commandIndex: handle.commandIndex },
          }), "canvas");
          return;
        case "convert-vector-point-line":
          updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
            node,
            pathIndex: handle.pathIndex,
            operation: { type: "convert-segment-to-line", commandIndex: handle.commandIndex },
          }), "canvas");
          return;
        case "delete-vector-point":
          updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
            node,
            pathIndex: handle.pathIndex,
            operation: { type: "delete-anchor", commandIndex: handle.commandIndex },
          }), "canvas");
          return;
        case "open-vector-path":
          updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
            node,
            pathIndex: handle.pathIndex,
            operation: { type: "set-closed", closed: false },
          }), "canvas");
          return;
        case "close-vector-path":
          updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
            node,
            pathIndex: handle.pathIndex,
            operation: { type: "set-closed", closed: true },
          }), "canvas");
          return;
        default:
          throw new Error(`FigEditorCanvas received unsupported vector context menu action ${actionId}`);
      }
    }
    const operationByAction: Record<string, BooleanOperationType> = {
      "boolean-union": "UNION",
      "boolean-subtract": "SUBTRACT",
      "boolean-intersect": "INTERSECT",
      "boolean-exclude": "EXCLUDE",
    };
    const operation = operationByAction[actionId];
    if (operation === undefined) {
      throw new Error(`FigEditorCanvas received unsupported context menu action ${actionId}`);
    }
    createBooleanOperationFromSelection(operation, "canvas");
  }, [contextMenu, createBooleanOperationFromSelection, updateNode]);

  const handleVectorPathHandlePointerDown = useCallback((
    handle: VectorPathHandle,
    event: ReactPointerEvent<SVGCircleElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    vectorPathDragRef.current = handle;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleVectorPathHandlePointerMove = useCallback((event: ReactPointerEvent<SVGCircleElement>): void => {
    const handle = vectorPathDragRef.current;
    if (handle === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = svgElementPoint(event.currentTarget, event.clientX, event.clientY);
    updateNode(handle.nodeGuid, (node) => updateVectorPathWithOperation({
      node,
      pathIndex: handle.pathIndex,
      operation: {
        type: "move-command-point",
        commandIndex: handle.commandIndex,
        valueIndex: handle.valueIndex,
        point,
      },
    }), "canvas");
  }, [updateNode]);

  const handleVectorPathHandlePointerUp = useCallback((event: ReactPointerEvent<SVGCircleElement>): void => {
    vectorPathDragRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleVectorPathSegmentClick = useCallback((
    pathIndex: number,
    event: ReactMouseEvent<SVGPathElement>,
  ): void => {
    if (primaryNode?.guid === undefined) {
      throw new Error("FigEditorCanvas vector path segment click requires a selected Kiwi node guid");
    }
    event.preventDefault();
    event.stopPropagation();
    const point = svgElementPoint(event.currentTarget, event.clientX, event.clientY);
    updateNode(primaryNode.guid, (node) => addVectorPathPoint({ node, pathIndex, point }), "canvas");
  }, [primaryNode, updateNode]);

  const handleVectorPathHandleContextMenu = useCallback((
    handle: VectorPathHandle,
    event: ReactMouseEvent<SVGCircleElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: "vector", x: event.clientX, y: event.clientY, handle });
  }, []);

  const handleVectorPathDraftHandlePointerDown = useCallback((
    handle: VectorPathDraftHandle,
    event: ReactPointerEvent<SVGCircleElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    vectorPathDraftHandleDragRef.current = {
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
  }, []);

  const vectorPathOverlay = useMemo(() => {
    if (!policy.canEditPath || primaryEditableVectorPaths === undefined) {
      return undefined;
    }
    if (primaryBounds === undefined) {
      throw new Error("FigEditorCanvas vector path overlay requires selected node bounds");
    }
    const orderedHandles = orderVectorPathHandlesForHitTesting(vectorPathHandles);
    return (
      <g transform={`translate(${primaryBounds.x} ${primaryBounds.y})`}>
        {editableVectorPathOverlays.map((overlay) => (
          <g key={overlay.key}>
            <path
              d={overlay.data}
              fill="none"
              stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <path
              d={overlay.data}
              fill="none"
              stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
              strokeOpacity={0.001}
              strokeWidth={VECTOR_PATH_OVERLAY_STYLE.segmentHitStrokeWidthPx}
              vectorEffect="non-scaling-stroke"
              role="button"
              aria-label={`Editable vector path segment ${overlay.pathIndex + 1}`}
              pointerEvents="stroke"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => handleVectorPathSegmentClick(overlay.pathIndex, event)}
            />
          </g>
        ))}
        {vectorPathControlLines.map((line) => (
          <line
            key={line.key}
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
            stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            strokeWidth={VECTOR_PATH_OVERLAY_STYLE.controlLineStrokeWidthPx}
            strokeDasharray={VECTOR_PATH_OVERLAY_STYLE.controlLineDashPx.join(" ")}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
        {orderedHandles.map((handle) => (
          <circle
            key={handle.key}
            role="button"
            aria-label={getVectorHandleAriaLabel(handle)}
            cx={handle.x}
            cy={handle.y}
            r={handle.role === "anchor" ? VECTOR_PATH_OVERLAY_STYLE.anchorRadiusPx : VECTOR_PATH_OVERLAY_STYLE.controlRadiusPx}
            fill={handle.role === "anchor" ? VECTOR_PATH_OVERLAY_STYLE.anchorFill : VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            strokeWidth={VECTOR_PATH_OVERLAY_STYLE.handleStrokeWidthPx}
            vectorEffect="non-scaling-stroke"
            pointerEvents="all"
            style={{ cursor: getVectorPathHandleCursor(handle) }}
            onPointerDown={(event) => handleVectorPathHandlePointerDown(handle, event)}
            onPointerMove={handleVectorPathHandlePointerMove}
            onPointerUp={handleVectorPathHandlePointerUp}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onContextMenu={(event) => handleVectorPathHandleContextMenu(handle, event)}
          />
        ))}
      </g>
    );
  }, [
    editableVectorPathOverlays,
    handleVectorPathHandleContextMenu,
    handleVectorPathHandlePointerDown,
    handleVectorPathHandlePointerMove,
    handleVectorPathHandlePointerUp,
    handleVectorPathSegmentClick,
    policy.canEditPath,
    primaryBounds,
    primaryEditableVectorPaths,
    vectorPathControlLines,
    vectorPathHandles,
  ]);

  const vectorPathDraftOverlay = useMemo(() => {
    if (!policy.canEditPath || vectorPathDraftSession === null) {
      return undefined;
    }
    const draft = vectorPathDraftSession.draft;
    const orderedHandles = orderVectorPathHandlesForHitTesting(getVectorPathDraftHandles(draft));
    return (
      <g>
        <path
          aria-label="Draft vector path preview"
          d={vectorPathDraftToPreviewPath(draft)}
          fill="none"
          stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <path
          role="button"
          aria-label="Draft vector path segment"
          d={vectorPathDraftToPreviewPath(draft)}
          fill="none"
          stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
          strokeOpacity={0.001}
          strokeWidth={VECTOR_PATH_OVERLAY_STYLE.segmentHitStrokeWidthPx}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {getVectorPathDraftControlLines(draft).map((line) => (
          <line
            key={line.key}
            aria-label="Draft vector path control line"
            x1={line.from.x}
            y1={line.from.y}
            x2={line.to.x}
            y2={line.to.y}
            stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            strokeWidth={VECTOR_PATH_OVERLAY_STYLE.controlLineStrokeWidthPx}
            strokeDasharray={VECTOR_PATH_OVERLAY_STYLE.controlLineDashPx.join(" ")}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
        {orderedHandles.map((handle) => (
          <circle
            key={handle.key}
            role="button"
            aria-label={getVectorPathDraftHandleLabel(handle)}
            cx={handle.x}
            cy={handle.y}
            r={handle.role === "anchor" ? VECTOR_PATH_OVERLAY_STYLE.anchorRadiusPx : VECTOR_PATH_OVERLAY_STYLE.controlRadiusPx}
            fill={handle.role === "anchor" ? VECTOR_PATH_OVERLAY_STYLE.anchorFill : VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            stroke={VECTOR_PATH_OVERLAY_STYLE.selectionColor}
            strokeWidth={VECTOR_PATH_OVERLAY_STYLE.handleStrokeWidthPx}
            vectorEffect="non-scaling-stroke"
            pointerEvents="all"
            style={{ cursor: getVectorPathDraftHandleCursor(draft, handle) }}
            onPointerDown={(event) => handleVectorPathDraftHandlePointerDown(handle, event)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        ))}
      </g>
    );
  }, [handleVectorPathDraftHandlePointerDown, policy.canEditPath, vectorPathDraftSession]);

  const interactionOverlay = useMemo(() => {
    if (vectorPathOverlay === undefined && vectorPathDraftOverlay === undefined) {
      return undefined;
    }
    return (
      <>
        {vectorPathOverlay}
        {vectorPathDraftOverlay}
      </>
    );
  }, [vectorPathDraftOverlay, vectorPathOverlay]);

  const handleItemDragMove = useCallback((coords: CanvasPageCoords): void => {
    const session = moveSessionRef.current;
    if (session === null) {
      return;
    }
    const point = worldPoint(coords);
    updateNode(session.guid, (node) => ({
      ...node,
      transform: translateTransform(node.transform, point.x - session.startX, point.y - session.startY),
    }), "canvas");
    moveSessionRef.current = { ...session, startX: point.x, startY: point.y };
  }, [updateNode]);

  const handleItemDragEnd = useCallback((coords: CanvasPageCoords): void => {
    const creationSession = creationDragSessionRef.current;
    creationDragSessionRef.current = null;
    if (creationSession !== null) {
      const end = worldPoint(coords);
      const rect = dragRect({ x: creationSession.startX, y: creationSession.startY }, end);
      const spec = nodeSpecForCreation(creationMode, rect);
      addNodeToActivePage(spec, null, "canvas");
      return;
    }
    moveSessionRef.current = null;
    endCanvasTransform();
  }, [addNodeToActivePage, creationMode, endCanvasTransform]);

  const handleCanvasPointerDown = useCallback((coords: CanvasPageCoords, event: ReactPointerEvent): void => {
    if (!policy.canEditPath) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    placeVectorPathDraftPoint(coords, event.nativeEvent);
  }, [placeVectorPathDraftPoint, policy.canEditPath]);

  const handleCanvasClick = useCallback((): void => {
    if (textEdit.type === "active") {
      exitTextEdit();
      return;
    }
    if (policy.canEditPath) {
      return;
    }
    if (policy.canCreate) {
      return;
    }
    clearSelection();
  }, [clearSelection, exitTextEdit, policy.canCreate, policy.canEditPath, textEdit.type]);

  const handleMarqueeSelect = useCallback((
    result: {
      readonly itemIds: readonly string[];
      readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    },
    additive: boolean,
  ): void => {
    if (policy.canCreate) {
      const spec = nodeSpecForCreation(creationMode, result.rect);
      addNodeToActivePage(spec, null, "canvas");
      return;
    }
    const guids = resolveSelectableMarqueeGuids(context.document, result.itemIds);
    if (additive) {
      setSelectedGuids([...selectedGuids, ...guids]);
      return;
    }
    setSelectedGuids(guids);
  }, [addNodeToActivePage, context.document, creationMode, policy.canCreate, selectedGuids, setSelectedGuids]);

  const textEditOverlay = useMemo(() => {
    if (textEdit.type !== "active") {
      return undefined;
    }
    const key = guidToString(textEdit.guid);
    const node = context.document.nodesByGuid.get(key);
    if (node === undefined) {
      throw new Error(`FigEditorCanvas: active text edit node ${key} is not present`);
    }
    if (getNodeType(node) !== "TEXT") {
      throw new Error(`FigEditorCanvas: active text edit node ${key} is not TEXT`);
    }
    const bounds = itemBounds.find((item) => item.id === key);
    if (bounds === undefined) {
      throw new Error(`FigEditorCanvas: active text edit node ${key} has no canvas bounds`);
    }
    return (
      <FigTextEditOverlay
        node={node}
        bounds={{
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rotation: bounds.rotation ?? 0,
        }}
        canvasWidth={extents.width}
        canvasHeight={extents.height}
        textFontResolver={textFontResolver}
        onExit={exitTextEdit}
      />
    );
  }, [context.document.nodesByGuid, exitTextEdit, extents.height, extents.width, itemBounds, textEdit, textFontResolver]);

  const rendererNode = useMemo(() => {
    if (renderWindow === null) {
      return undefined;
    }
    return (
      <FigPageRenderer
        page={activePage}
        nodes={pageChildren}
        canvasWidth={renderWindow.surfaceWidth}
        canvasHeight={renderWindow.surfaceHeight}
        viewportX={renderWindow.x}
        viewportY={renderWindow.y}
        viewportWidth={renderWindow.width}
        viewportHeight={renderWindow.height}
        viewportScale={viewportScale}
        viewportRevision={viewportRevision}
        resources={resources}
        renderOptions={createFigFamilyRenderOptions(context)}
        renderer={renderer}
        host="html"
        textFontResolver={textFontResolver}
        webglInitializationDelayMs={webglInitializationDelayMs}
      />
    );
  }, [
    activePage,
    context,
    pageChildren,
    renderWindow,
    renderer,
    resources,
    textFontResolver,
    viewportRevision,
    viewportScale,
    webglInitializationDelayMs,
  ]);

  return (
    <div data-fig-editor-canvas="" style={{ ...canvasHostStyle, ...style }}>
      <EditorCanvas
        ref={canvasRef}
        canvasWidth={extents.width}
        canvasHeight={extents.height}
        zoomMode={zoomMode}
        onZoomModeChange={setZoomMode}
        onViewportChange={handleViewportChange}
        initialViewportPlacement="top"
        initialViewportMargin={INITIAL_VIEWPORT_MARGIN}
        showRulers
        rulerCoordinateMode="unbounded"
        rulerCoordinateOffset={{ x: 0, y: 0 }}
        clampFn={(viewportValue) => viewportValue}
        itemBounds={itemBounds}
        getItemAriaLabel={(id) => createItemLabel(context.document.nodesByGuid, id)}
        selectedIds={selectedIds}
        primaryId={primaryId}
        onItemPointerDown={handleItemPointerDown}
        onItemClick={handleItemClick}
        onItemDoubleClick={handleItemDoubleClick}
        onItemContextMenu={handleItemContextMenu}
        onItemDragMove={handleItemDragMove}
        onItemDragEnd={handleItemDragEnd}
        onCanvasPointerDown={handleCanvasPointerDown}
        onCanvasClick={handleCanvasClick}
        onContextMenu={(event) => event.preventDefault()}
        interactionOverlay={interactionOverlay}
        enableMarquee={policy.marqueeEnabled || policy.canCreate}
        onMarqueeSelect={handleMarqueeSelect}
        selectionInteractionEnabled={policy.canMove}
        isTextEditing={textEdit.type === "active"}
        svgAriaHidden={textEdit.type === "active"}
        screenViewportContent={rendererNode}
        viewportOverlay={textEditOverlay}
      >
        {children}
      </EditorCanvas>
      {contextMenu !== null && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onAction={runContextMenuAction}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
