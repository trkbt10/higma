/**
 * @file Top-level viewer: 3-pane layout (Layers | Stage | Inspect)
 * with shared selection, hover, and viewport state.
 *
 * The viewer owns:
 *   - the active page selection
 *   - the hovered node id and the multi-node selection state
 *     (`SelectionState` from `./selection`)
 *   - the viewport transform (pan + zoom) and fit mode
 *   - the export request state (busy + error + per-node rollup)
 *
 * Selection model — a single `SelectionState` value drives both the
 * canvas overlay and the layers tree, so range/toggle clicks on either
 * surface update the other immediately. The painter-order id list used
 * for shift-click range selection comes from `nodeBounds`, so range
 * selection on the canvas matches range selection on the tree.
 *
 * Viewport model — same shape as the editor's infinite canvas:
 *   - The DOM canvas is sized to the *visible stage*, not the design.
 *     A 50k×50k page at 8× zoom would otherwise materialise a 400k×400k
 *     element and break layout / WebGL allocation.
 *   - Pan + zoom are state (`translateX/Y`, `scale`). The renderer is
 *     fed a world-space window — `viewport.x = -tx/scale`,
 *     `viewport.width = surfaceWidth/scale` — and it handles the
 *     world→surface mapping internally. No CSS scrollbars, no CSS
 *     `transform: scale(...)` on a giant inner div.
 *   - Hit-testing inverts the same transform: `world = (canvas - t) / s`.
 *
 * Styling relies entirely on `--vscode-*` CSS custom properties so
 * the viewer adapts to the active editor theme without per-theme
 * code (the dev playground at `dev/index.html` seeds these so the UI
 * also paints correctly outside VS Code).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  figDocumentResources,
  findCanvases,
  type FigDocumentContext,
  type FigDocumentResources,
} from "@higma-document-io/fig";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { createFigFamilyRenderOptions, useFigSceneGraph } from "@higma-figma-runtime/react-renderer";
import { computePageBounds, type PageBounds } from "./page-bounds";
import { computeNodeBounds, indexBoundsById, type NodeBounds } from "./geometry/node-bounds";
import { findNodeAtPoint } from "./geometry/hit-test";
import { LayersPanel } from "./panels/LayersPanel";
import { InspectPanel } from "./panels/InspectPanel";
import { HoverOverlay, HoverTooltip } from "./panels/HoverOverlay";
import { WebGLViewport } from "./webgl/WebGLViewport";
import { renderNodeToSvg } from "./export/render-node-svg";
import { rasterizeSvg } from "./export/rasterize";
import { triggerBlobDownload, buildExportFileName } from "./export/download";
import type { ExportRequest, ExportRollupStatus } from "./export/types";
import {
  EMPTY_SELECTION,
  applyClickSelection,
  clampSelectionToIds,
  selectionAsSet,
  type SelectionModifiers,
  type SelectionState,
} from "./selection";

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const FIT_PADDING = 48;
const JPEG_ALPHA_FLATTEN_BACKGROUND = "#ffffff";
// Tuned so that a single notch of a typical mouse wheel (deltaY≈100,
// deltaMode=0) produces ~1.16× / ~0.86× — close to Figma's per-notch
// zoom step but smooth for trackpad pinch which streams small deltas.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WHEEL_LINE_HEIGHT = 16;
// Distance the pointer must travel (in CSS px) before a press counts as
// a pan rather than a click. Smaller than this and the click handler
// still fires so a quick middle-click does not feel like dead input.
const PAN_MOVE_THRESHOLD = 3;

type FigViewerProps = {
  readonly fileName: string;
  readonly context: FigDocumentContext;
};

export type ViewportTransform = {
  readonly translateX: number;
  readonly translateY: number;
  readonly scale: number;
};

type ZoomMode = "fit" | "manual";

type Size = { readonly width: number; readonly height: number };

type Cursor = { readonly x: number; readonly y: number };

function clampZoom(value: number): number {
  if (value < MIN_ZOOM) {return MIN_ZOOM;}
  if (value > MAX_ZOOM) {return MAX_ZOOM;}
  return value;
}

function nextZoomLevel(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const above = ZOOM_LEVELS.find((level) => level > current + 0.0001);
    return above ?? MAX_ZOOM;
  }
  const reversedLevels = ZOOM_LEVELS.slice().reverse();
  const below = reversedLevels.find((level) => level < current - 0.0001);
  return below ?? MIN_ZOOM;
}

/**
 * Re-scale around a fixed surface-px point — the standard "zoom toward
 * cursor" map. Keeping the world point under `(centerX, centerY)`
 * invariant gives `t' = c - (c - t) * (s'/s)`.
 */
function rescaleAround(
  vp: ViewportTransform,
  newScale: number,
  centerX: number,
  centerY: number,
): ViewportTransform {
  if (newScale === vp.scale) {return vp;}
  const ratio = newScale / vp.scale;
  return {
    scale: newScale,
    translateX: centerX - ratio * (centerX - vp.translateX),
    translateY: centerY - ratio * (centerY - vp.translateY),
  };
}

function wheelDeltaFactor(deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) {return WHEEL_LINE_HEIGHT;}
  if (deltaMode === 2) {return pageHeight;}
  return 1;
}

function normaliseWheelDelta(event: WheelEvent, pageHeight: number): { readonly dx: number; readonly dy: number } {
  const factor = wheelDeltaFactor(event.deltaMode, pageHeight);
  return { dx: event.deltaX * factor, dy: event.deltaY * factor };
}

function shouldClearCanvasClick(modifiers: SelectionModifiers): boolean {
  return !modifiers.meta && !modifiers.shift;
}

function clearSelectionForCanvasMiss(modifiers: SelectionModifiers, clearSelection: () => void): void {
  if (shouldClearCanvasClick(modifiers)) {
    clearSelection();
  }
}

/**
 * Build the viewport that places `pageBounds` centred inside a stage of
 * `surface` size, scaled to fit with `padding` margin on each side.
 *
 * Differs from `getCenteredViewport` in `@higma-editor-kernel`: that one
 * is defined for a slide world origin at (0, 0). A fig page's content can
 * start at any `(bounds.x, bounds.y)`, so the centring math has to bake
 * in that offset — otherwise an artboard placed at world (10000, 10000)
 * would render entirely off-screen on first paint.
 */
function fitViewport(
  pageBounds: PageBounds,
  surface: Size,
  padding: number,
): ViewportTransform {
  const availW = Math.max(1, surface.width - padding * 2);
  const availH = Math.max(1, surface.height - padding * 2);
  const scale = clampZoom(Math.min(availW / pageBounds.width, availH / pageBounds.height));
  const translateX = (surface.width - pageBounds.width * scale) / 2 - pageBounds.x * scale;
  const translateY = (surface.height - pageBounds.height * scale) / 2 - pageBounds.y * scale;
  return { translateX, translateY, scale };
}

/** Render the VS Code fig viewer against a Kiwi document context. */
export function FigViewer({ fileName, context }: FigViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const resources = useMemo<FigDocumentResources>(() => figDocumentResources(context), [context]);
  const pages = useMemo<readonly FigNode[]>(
    () => findCanvases(context.document),
    [context],
  );

  const initialPageId = useMemo<string | null>(() => {
    const withChildren = pages.find((page) => resources.childrenOf(page).length > 0);
    const target = withChildren ?? pages[0];
    return target ? guidToString(target.guid) : null;
  }, [pages, resources]);

  const [activePageId, setActivePageId] = useState<string | null>(initialPageId);
  useEffect(() => {
    setActivePageId(initialPageId);
  }, [initialPageId]);

  const activePage = useMemo<FigNode | null>(() => {
    if (!activePageId) {return null;}
    return pages.find((page) => guidToString(page.guid) === activePageId) ?? null;
  }, [activePageId, pages]);

  const activePageChildren = useMemo<readonly FigNode[]>(() => {
    if (!activePage) {return [];}
    return resources.childrenOf(activePage);
  }, [activePage, resources]);

  const pageBounds = useMemo<PageBounds | null>(() => {
    if (!activePage) {return null;}
    return computePageBounds(activePageChildren);
  }, [activePage, activePageChildren]);

  const nodeBounds = useMemo<readonly NodeBounds[]>(() => {
    if (!activePage) {return [];}
    return computeNodeBounds(activePage, resources.childrenOf);
  }, [activePage, resources]);

  const boundsById = useMemo(() => indexBoundsById(nodeBounds), [nodeBounds]);
  const orderedIds = useMemo<readonly string[]>(
    () => nodeBounds.map((entry) => entry.id),
    [nodeBounds],
  );
  const validIdSet = useMemo<ReadonlySet<string>>(
    () => new Set(orderedIds),
    [orderedIds],
  );

  const renderOptions = useMemo(() => createFigFamilyRenderOptions(context), [context]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [cursor, setCursor] = useState<Cursor | null>(null);

  // Reset hover when the active page changes — ids from a previous
  // page are not valid in the new tree.
  useEffect(() => {
    setHoveredId(null);
    setCursor(null);
  }, [activePageId]);

  // Drop selection ids that no longer exist on this page (page change,
  // or document mutation). Keeping stale ids would leave "ghost"
  // overlays anchored at world positions from a different tree.
  useEffect(() => {
    setSelection((prev) => clampSelectionToIds(prev, validIdSet));
  }, [validIdSet]);

  const hoveredNode = hoveredId ? (boundsById.get(hoveredId) ?? null) : null;
  const selectedIds = useMemo(() => selectionAsSet(selection), [selection]);
  const selectedBounds = useMemo<readonly NodeBounds[]>(() => {
    if (selection.ids.length === 0) {return [];}
    const out: NodeBounds[] = [];
    for (const id of selection.ids) {
      const bounds = boundsById.get(id);
      if (bounds) {out.push(bounds);}
    }
    return out;
  }, [selection, boundsById]);

  const selectedFigNodes = useMemo<readonly FigNode[]>(() => {
    if (selection.ids.length === 0) {return [];}
    const out: FigNode[] = [];
    for (const id of selection.ids) {
      const node = context.document.nodesByGuid.get(id);
      if (node) {out.push(node);}
    }
    return out;
  }, [selection, context]);

  const handleSelectId = useCallback(
    (id: string, modifiers: SelectionModifiers) => {
      setSelection((prev) => applyClickSelection(prev, id, modifiers, orderedIds));
    },
    [orderedIds],
  );

  const handleClearSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);

  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [manualViewport, setManualViewport] = useState<ViewportTransform | null>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {return;}
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {return;}
      const { width, height } = entry.contentRect;
      setStageSize({ width, height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Reset to fit mode whenever the page changes — the manual viewport
  // points at world coords from the prior page that may not exist in
  // the new page (e.g. the new top-level frame is at (0, 0) but the
  // old translate kept the renderer pointed at (10000, 10000)).
  useEffect(() => {
    setZoomMode("fit");
    setManualViewport(null);
  }, [activePageId]);

  // Fit viewport is recomputed from `pageBounds + stageSize`. It also
  // serves as the seed for `manualViewport` whenever the user makes
  // their first interaction — that way, "switch from fit to manual"
  // never visibly snaps the page.
  const fittedViewport = useMemo<ViewportTransform | null>(() => {
    if (!pageBounds || stageSize.width <= 0 || stageSize.height <= 0) {return null;}
    return fitViewport(pageBounds, stageSize, FIT_PADDING);
  }, [pageBounds, stageSize]);

  const viewport = useMemo<ViewportTransform>(() => {
    if (zoomMode === "fit" && fittedViewport) {return fittedViewport;}
    return manualViewport ?? fittedViewport ?? { translateX: 0, translateY: 0, scale: 1 };
  }, [zoomMode, fittedViewport, manualViewport]);

  // Refs so the imperative wheel/pointer handlers always read the
  // freshest viewport without re-attaching listeners every frame.
  const viewportRef = useRef(viewport);
  const stageSizeRef = useRef(stageSize);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    stageSizeRef.current = stageSize;
  }, [stageSize]);

  // Commit a new viewport — always switches into manual mode so the fit
  // calculation does not stomp the user's pan/zoom on the next render.
  const commitViewport = useCallback((next: ViewportTransform) => {
    setManualViewport(next);
    setZoomMode("manual");
  }, []);

  const handleZoomIn = useCallback(() => {
    const current = viewportRef.current;
    const stageNow = stageSizeRef.current;
    const next = clampZoom(nextZoomLevel(current.scale, 1));
    commitViewport(rescaleAround(current, next, stageNow.width / 2, stageNow.height / 2));
  }, [commitViewport]);
  const handleZoomOut = useCallback(() => {
    const current = viewportRef.current;
    const stageNow = stageSizeRef.current;
    const next = clampZoom(nextZoomLevel(current.scale, -1));
    commitViewport(rescaleAround(current, next, stageNow.width / 2, stageNow.height / 2));
  }, [commitViewport]);
  const handleFit = useCallback(() => {
    setZoomMode("fit");
    setManualViewport(null);
  }, []);
  const handleResetZoom = useCallback(() => {
    const current = viewportRef.current;
    const stageNow = stageSizeRef.current;
    commitViewport(rescaleAround(current, 1, stageNow.width / 2, stageNow.height / 2));
  }, [commitViewport]);

  const handlePageChange = useCallback((id: string) => {
    setActivePageId(id);
    // Page change clears selection too — ids from the previous page
    // cannot be evaluated against the new tree.
    setSelection(EMPTY_SELECTION);
  }, []);
  const handlePageSelectChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setActivePageId(event.target.value);
    setSelection(EMPTY_SELECTION);
  }, []);

  // Surface px under cursor → world (page) px. Same inverse the
  // renderer applies internally: `world = (canvasLocal - t) / s`.
  const cursorToPagePoint = useCallback(
    (clientX: number, clientY: number): { readonly x: number; readonly y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) {return null;}
      const rect = canvas.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return {
        x: (localX - viewport.translateX) / viewport.scale,
        y: (localY - viewport.translateY) / viewport.scale,
      };
    },
    [viewport],
  );

  // Native (non-passive) wheel listener so we can preventDefault when
  // the gesture is a zoom (Ctrl/Cmd + wheel, or trackpad pinch which
  // browsers also surface as a ctrlKey wheel event). Plain wheel without
  // modifier pans (Figma's convention): the page scrolls in surface px.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {return;}
    const onWheel = (event: WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) {return;}
      const rect = canvas.getBoundingClientRect();
      // Normalise deltaMode so line- and page-mode wheels still produce
      // sensible step sizes. deltaMode 0 (pixels) is the common case.
      const pageHeight = rect.height || 1;
      const { dx, dy } = normaliseWheelDelta(event, pageHeight);

      event.preventDefault();
      const current = viewportRef.current;
      if (!event.ctrlKey && !event.metaKey) {
        // Plain wheel = pan. preventDefault stops the surrounding page
        // from scrolling (the stage container itself has no scrollbars).
        commitViewport({
          ...current,
          translateX: current.translateX - dx,
          translateY: current.translateY - dy,
        });
        return;
      }
      const factor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY);
      const next = clampZoom(current.scale * factor);
      if (next === current.scale) {return;}
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      commitViewport(rescaleAround(current, next, cx, cy));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [commitViewport]);

  // Drag-pan: middle-mouse drag, or Space+left-drag (Figma convention).
  // While Space is held, plain left-drag pans instead of selecting; the
  // click handler suppresses selection if the press actually moved.
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const panStateRef = useRef<{
    pointerId: number;
    startTranslateX: number;
    startTranslateY: number;
    startScale: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    const isFormTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {return false;}
      if (target.isContentEditable) {return true;}
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {return;}
      if (event.repeat) {return;}
      if (isFormTarget(event.target)) {return;}
      // Stop the page from scrolling on Space; that conflicts with
      // hold-space-to-pan. We do not stopPropagation, so other key
      // handlers still see the event.
      event.preventDefault();
      setSpacePan(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {return;}
      setSpacePan(false);
    };
    // `keydown`/`keyup` from the window so the pan toggle works no
    // matter where focus sits — including the body when nothing has
    // been clicked yet.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const handleStagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const startPan = event.button === 1 || (event.button === 0 && spacePan);
      if (!startPan) {return;}
      // preventDefault stops Chrome's middle-click autoscroll cursor
      // and the text selection that Space+drag would otherwise start.
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) {return;}
      stage.setPointerCapture(event.pointerId);
      const start = viewportRef.current;
      panStateRef.current = {
        pointerId: event.pointerId,
        startTranslateX: start.translateX,
        startTranslateY: start.translateY,
        startScale: start.scale,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
      };
      setPanning(true);
    },
    [spacePan],
  );

  const handleStagePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pan = panStateRef.current;
      if (pan && pan.pointerId === event.pointerId) {
        const dx = event.clientX - pan.startClientX;
        const dy = event.clientY - pan.startClientY;
        pan.moved = pan.moved || Math.hypot(dx, dy) > PAN_MOVE_THRESHOLD;
        commitViewport({
          scale: pan.startScale,
          translateX: pan.startTranslateX + dx,
          translateY: pan.startTranslateY + dy,
        });
        return;
      }
      setCursor({ x: event.clientX, y: event.clientY });
      const point = cursorToPagePoint(event.clientX, event.clientY);
      if (!point) {
        setHoveredId(null);
        return;
      }
      const hit = findNodeAtPoint(nodeBounds, point);
      setHoveredId(hit ? hit.id : null);
    },
    [commitViewport, cursorToPagePoint, nodeBounds],
  );

  const finishPan = useCallback((pointerId: number) => {
    const pan = panStateRef.current;
    if (!pan || pan.pointerId !== pointerId) {return;}
    const stage = stageRef.current;
    if (stage && stage.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
    if (pan.moved) {suppressNextClickRef.current = true;}
    panStateRef.current = null;
    setPanning(false);
  }, []);

  const handleStagePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishPan(event.pointerId);
    },
    [finishPan],
  );

  const handleStagePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishPan(event.pointerId);
    },
    [finishPan],
  );

  const handleStagePointerLeave = useCallback(() => {
    if (panStateRef.current) {return;}
    setHoveredId(null);
    setCursor(null);
  }, []);

  const handleStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      // Space-held click is part of the pan gesture — never a select.
      if (spacePan) {return;}
      const point = cursorToPagePoint(event.clientX, event.clientY);
      const modifiers: SelectionModifiers = {
        meta: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      };
      if (!point) {
        clearSelectionForCanvasMiss(modifiers, handleClearSelection);
        return;
      }
      const hit = findNodeAtPoint(nodeBounds, point);
      if (!hit) {
        // Background click: only clear the selection on a plain click.
        // A modifier-augmented click on empty space leaves the
        // selection alone — matches Figma, where Cmd-click on empty
        // canvas is a no-op rather than a deselect.
        clearSelectionForCanvasMiss(modifiers, handleClearSelection);
        return;
      }
      setSelection((prev) => applyClickSelection(prev, hit.id, modifiers, orderedIds));
    },
    [cursorToPagePoint, handleClearSelection, nodeBounds, orderedIds, spacePan],
  );

  // ----------------------------------------------------------------------
  // Export rollup
  //
  // The viewer iterates the current selection and runs each node
  // through `renderNodeToSvg` + (optionally) `rasterizeSvg` in series.
  // Series rather than parallel: each `renderNodeToSvg` mounts a
  // hidden React root and waits two frames. Running them concurrently
  // would interleave commits and font/image decode races.
  //
  // Filenames are deduped per request — duplicate node names get
  // numeric suffixes — and per-node failures are accumulated rather
  // than aborted, so a broken text node mid-list does not stop the
  // remaining shapes from downloading.
  // ----------------------------------------------------------------------

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportRollupStatus>({ kind: "idle" });

  const handleExport = useCallback(
    async (request: ExportRequest) => {
      if (!activePage || selectedFigNodes.length === 0) {
        setExportError("Select at least one layer to export.");
        return;
      }
      setExporting(true);
      setExportError(null);
      const total = selectedFigNodes.length;
      setExportStatus({ kind: "running", completed: 0, total });

      try {
        const rollup = await runExportRollup({
          nodes: selectedFigNodes,
          page: activePage,
          context,
          renderOptions,
          request,
          onProgress: (completed) => {
            setExportStatus({ kind: "running", completed, total });
          },
        });
        setExportStatus({ kind: "done", succeeded: rollup.succeeded, failed: rollup.failed });
        setExportError(buildRollupErrorMessage(rollup));
      } finally {
        setExporting(false);
      }
    },
    [activePage, context, renderOptions, selectedFigNodes],
  );

  return (
    <div className="higma-fig-app">
      <div className="higma-fig-toolbar" role="toolbar" aria-label="Fig viewer controls">
        <span className="higma-fig-toolbar__filename" title={fileName}>
          {fileName}
        </span>
        {pages.length > 1 && (
          <div className="higma-fig-toolbar__group">
            <label className="higma-fig-toolbar__label" htmlFor="higma-fig-page-select">
              Page
            </label>
            <select
              id="higma-fig-page-select"
              className="higma-fig-select"
              value={activePageId ?? ""}
              onChange={handlePageSelectChange}
            >
              {pages.map((page) => {
                const pageId = guidToString(page.guid);
                return (
                  <option key={pageId} value={pageId}>
                    {page.name ?? "Page"}
                  </option>
                );
              })}
            </select>
          </div>
        )}
        <div className="higma-fig-toolbar__spacer" />
        <div className="higma-fig-toolbar__group" aria-label="Zoom">
          <button
            type="button"
            className="higma-fig-button"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="higma-fig-button higma-fig-zoom-display"
            onClick={handleResetZoom}
            aria-label="Reset zoom to 100%"
            title="Reset zoom to 100%"
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            className="higma-fig-button"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="higma-fig-button"
            onClick={handleFit}
            aria-label="Fit to window"
            title="Fit to window"
            aria-pressed={zoomMode === "fit"}
          >
            Fit
          </button>
        </div>
      </div>
      <div className="higma-fig-workspace">
        <LayersPanel
          document={context.document}
          pages={pages}
          activePage={activePage}
          activePageId={activePageId}
          onPageChange={handlePageChange}
          childrenOf={resources.childrenOf}
          hoveredId={hoveredId}
          selectedIds={selectedIds}
          primaryId={selection.primaryId}
          onHover={setHoveredId}
          onSelect={handleSelectId}
          onClearSelection={handleClearSelection}
        />
        <div
          className="higma-fig-stage"
          ref={stageRef}
          data-pan-mode={spacePan ? "true" : "false"}
          data-panning={panning ? "true" : "false"}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerCancel}
          onPointerLeave={handleStagePointerLeave}
          onClick={handleStageClick}
        >
          <FigStageContent
            page={activePage}
            hasContent={activePageChildren.length > 0}
            viewport={viewport}
            surface={stageSize}
            resources={resources}
            renderOptions={renderOptions}
            hoveredNode={hoveredNode}
            selectedBounds={selectedBounds}
            primaryId={selection.primaryId}
            canvasRef={canvasRef}
          />
        </div>
        <InspectPanel
          selectedNodes={selectedFigNodes}
          selectedBounds={selectedBounds}
          onExport={(req) => void handleExport(req)}
          exporting={exporting}
          exportError={exportError}
          exportStatus={exportStatus}
        />
      </div>
      {hoveredNode && cursor && <HoverTooltip node={hoveredNode} cursor={cursor} />}
    </div>
  );
}

type RolloupResult = {
  readonly succeeded: number;
  readonly failed: ReadonlyArray<{ readonly name: string; readonly message: string }>;
};

type RolloupArgs = {
  readonly nodes: readonly FigNode[];
  readonly page: FigNode;
  readonly context: FigDocumentContext;
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly request: ExportRequest;
  readonly onProgress: (completed: number) => void;
};

/**
 * Run a series of single-node exports against the current selection.
 *
 * Series rather than parallel: each `renderNodeToSvg` mounts a hidden
 * React root and waits two frames; running them concurrently would
 * interleave commits and font/image decode races.
 *
 * Per-node failures are accumulated rather than thrown — a broken text
 * node mid-list does not stop the remaining shapes from downloading.
 */
async function runExportRollup(args: RolloupArgs): Promise<RolloupResult> {
  const usedNames = new Map<string, number>();
  const failed: { name: string; message: string }[] = [];
  const accumulator = { succeeded: 0 };
  for (let i = 0; i < args.nodes.length; i += 1) {
    const node = args.nodes[i];
    if (!node) {continue;}
    await runOneNode({
      node,
      page: args.page,
      context: args.context,
      renderOptions: args.renderOptions,
      request: args.request,
      usedNames,
      failed,
      accumulator,
    });
    args.onProgress(i + 1);
  }
  return { succeeded: accumulator.succeeded, failed };
}

type RunOneNodeArgs = ExportSingleArgs & {
  readonly failed: { name: string; message: string }[];
  readonly accumulator: { succeeded: number };
};

/**
 * Wrap `exportSingleNode` so the rollup loop can stay free of nested
 * try/catch — `runExportRollup`'s eslint config forbids them.
 */
async function runOneNode(args: RunOneNodeArgs): Promise<void> {
  try {
    await exportSingleNode({
      node: args.node,
      page: args.page,
      context: args.context,
      renderOptions: args.renderOptions,
      request: args.request,
      usedNames: args.usedNames,
    });
    args.accumulator.succeeded += 1;
  } catch (error: unknown) {
    args.failed.push({
      name: args.node.name ?? getNodeType(args.node),
      message: describeError(error),
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildRollupErrorMessage(result: RolloupResult): string | null {
  if (result.succeeded > 0 || result.failed.length === 0) {
    return null;
  }
  if (result.failed.length !== 1) {
    return `Failed to export ${result.failed.length} layers.`;
  }
  const first = result.failed[0];
  if (first) {
    return `${first.name}: ${first.message}`;
  }
  return `Failed to export ${result.failed.length} layers.`;
}

type ExportSingleArgs = {
  readonly node: FigNode;
  readonly page: FigNode;
  readonly context: FigDocumentContext;
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly request: ExportRequest;
  readonly usedNames: Map<string, number>;
};

async function exportSingleNode(args: ExportSingleArgs): Promise<void> {
  const { node, page, context, renderOptions, request, usedNames } = args;
  const baseName = node.name ?? getNodeType(node);
  const extension = extensionForFormat(request.format);
  const proposedName = buildExportFileName({
    baseName,
    suffix: request.suffix,
    extension,
  });
  const fileName = dedupeFileName(proposedName, usedNames);

  const rendered = await renderNodeToSvg({
    context,
    page,
    node,
    renderOptions,
  });
  if (request.format === "SVG") {
    const blob = new Blob([rendered.svgString], { type: "image/svg+xml;charset=utf-8" });
    triggerBlobDownload(blob, fileName);
    return;
  }
  const blob = await rasterizeSvg({
    svgString: rendered.svgString,
    width: rendered.width,
    height: rendered.height,
    scale: request.scale,
    format: request.format,
    jpegBackground: JPEG_ALPHA_FLATTEN_BACKGROUND,
  });
  triggerBlobDownload(blob, fileName);
}

function extensionForFormat(format: ExportRequest["format"]): "svg" | "png" | "jpg" {
  if (format === "SVG") {return "svg";}
  if (format === "PNG") {return "png";}
  return "jpg";
}

/**
 * Append a numeric suffix to `name` when the same filename has already
 * been emitted in this rollup. Two layers called "Icon" become
 * `Icon.png` and `Icon (2).png`.
 */
function dedupeFileName(name: string, used: Map<string, number>): string {
  const count = used.get(name) ?? 0;
  if (count === 0) {
    used.set(name, 1);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  // Try `(2)`, `(3)`, … until a free slot is found. The bookkeeping
  // map only tracks the base name, so we still need to verify each
  // candidate to handle the unlikely case where the user named one
  // layer literally "Icon (2)".
  for (let n = count + 1; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.set(name, n);
      used.set(candidate, 1);
      return candidate;
    }
  }
}

type FigStageContentProps = {
  readonly page: FigNode | null;
  /** True when the page has at least one renderable child. */
  readonly hasContent: boolean;
  readonly viewport: ViewportTransform;
  /** CSS-pixel size of the visible stage. Drives surface + render-window sizing. */
  readonly surface: Size;
  readonly resources: FigDocumentResources;
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly hoveredNode: NodeBounds | null;
  readonly selectedBounds: readonly NodeBounds[];
  readonly primaryId: string | null;
  readonly canvasRef: React.RefObject<HTMLDivElement | null>;
};

const MIN_RENDER_DIM = 1;

function FigStageContent({
  page,
  hasContent,
  viewport,
  surface,
  resources,
  renderOptions,
  hoveredNode,
  selectedBounds,
  primaryId,
  canvasRef,
}: FigStageContentProps) {
  // The renderer wants surface = visible CSS px and viewport = the
  // *world*-space rectangle visible inside that surface. Inverting our
  // transform: a surface px (sx, sy) maps to world ((sx - tx) / s,
  // (sy - ty) / s), so the visible world top-left is (-tx/s, -ty/s)
  // and the visible world size is (surfaceW / s, surfaceH / s).
  const surfaceWidth = Math.max(MIN_RENDER_DIM, surface.width);
  const surfaceHeight = Math.max(MIN_RENDER_DIM, surface.height);
  const worldX = -viewport.translateX / viewport.scale;
  const worldY = -viewport.translateY / viewport.scale;
  const worldW = surfaceWidth / viewport.scale;
  const worldH = surfaceHeight / viewport.scale;

  // The scene graph is built unconditionally so React still has a
  // stable hook order across "no page" and "ready" states. When
  // there is no page the hook returns null and the WebGL viewport
  // skips renderer initialisation.
  const sceneGraph = useFigSceneGraph({
    page,
    canvasWidth: surfaceWidth,
    canvasHeight: surfaceHeight,
    viewportX: worldX,
    viewportY: worldY,
    viewportWidth: Math.max(MIN_RENDER_DIM, worldW),
    viewportHeight: Math.max(MIN_RENDER_DIM, worldH),
    resources,
  });

  if (!page || !hasContent) {
    return <div className="higma-fig-status">This file does not contain any pages to render.</div>;
  }
  return (
    <div className="higma-fig-canvas" ref={canvasRef}>
      <WebGLViewport
        sceneGraph={sceneGraph}
        renderOptions={renderOptions}
        viewportScale={viewport.scale}
      />
      <HoverOverlay
        viewport={viewport}
        hovered={hoveredNode}
        selected={selectedBounds}
        primaryId={primaryId}
      />
    </div>
  );
}
