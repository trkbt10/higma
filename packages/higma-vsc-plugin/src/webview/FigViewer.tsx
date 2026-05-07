/**
 * @file Top-level viewer: 3-pane layout (Layers | Stage | Inspect)
 * with shared selection, hover, and viewport state.
 *
 * The viewer owns:
 *   - the active page selection
 *   - the hovered and selected node ids
 *   - the viewport transform (pan + zoom) and fit mode
 *   - the export request state (busy + error message)
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
import type {
  FigDesignDocument,
  FigDesignNode,
  FigNodeId,
  FigPage,
  FigPageId,
} from "@higma-document-models/fig/domain";
import { toPageId } from "@higma-document-models/fig/domain";
import { dfsById } from "@higma-primitives/tree";
import { useFigSceneGraph, createFigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import { createCanvasMetricsTextFontResolver } from "@higma-document-renderers/fig/font-drivers/browser";
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
import type { ExportRequest } from "./export/types";

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const FIT_PADDING = 48;
// Tuned so that a single notch of a typical mouse wheel (deltaY≈100,
// deltaMode=0) produces ~1.16× / ~0.86× — close to Figma's per-notch
// zoom step but smooth for trackpad pinch which streams small deltas.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
// Distance the pointer must travel (in CSS px) before a press counts as
// a pan rather than a click. Smaller than this and the click handler
// still fires so a quick middle-click does not feel like dead input.
const PAN_MOVE_THRESHOLD = 3;

type FigViewerProps = {
  readonly fileName: string;
  readonly document: FigDesignDocument;
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

/**
 * Build the viewport that places `pageBounds` centred inside a stage of
 * `surface` size, scaled to fit with `padding` margin on each side.
 *
 * Differs from `getCenteredViewport` in `@higma-editor-kernel`: that one
 * assumes the slide's world origin is (0, 0). A fig page's content can
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






export function FigViewer({ fileName, document }: FigViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const initialPageId = useMemo<FigPageId | null>(() => {
    const withChildren = document.pages.find((page) => page.children.length > 0);
    const target = withChildren ?? document.pages[0];
    return target ? target.id : null;
  }, [document]);

  const [activePageId, setActivePageId] = useState<FigPageId | null>(initialPageId);
  useEffect(() => {
    setActivePageId(initialPageId);
  }, [initialPageId]);

  const activePage = useMemo<FigPage | null>(() => {
    if (!activePageId) {return null;}
    return document.pages.find((page) => page.id === activePageId) ?? null;
  }, [activePageId, document]);

  const pageBounds = useMemo<PageBounds | null>(() => {
    if (!activePage) {return null;}
    return computePageBounds(activePage.children);
  }, [activePage]);

  const nodeBounds = useMemo<readonly NodeBounds[]>(() => {
    if (!activePage) {return [];}
    return computeNodeBounds(activePage);
  }, [activePage]);

  const boundsById = useMemo(() => indexBoundsById(nodeBounds), [nodeBounds]);

  const renderOptions = useMemo(() => createFigFamilyRenderOptions(document), [document]);
  const textFontResolver = useMemo(() => createCanvasMetricsTextFontResolver(), []);

  const [hoveredId, setHoveredId] = useState<FigNodeId | null>(null);
  const [selectedId, setSelectedId] = useState<FigNodeId | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);

  // Reset selection / hover when the active page changes — the ids
  // from a previous page are not valid in the new page's tree.
  useEffect(() => {
    setSelectedId(null);
    setHoveredId(null);
    setCursor(null);
  }, [activePageId]);

  const hoveredNode = hoveredId ? (boundsById.get(hoveredId) ?? null) : null;
  const selectedNode = selectedId ? (boundsById.get(selectedId) ?? null) : null;
  const selectedFigNode = useMemo(
    () => (selectedId && activePage ? findNodeInPage(activePage.children, selectedId) : null),
    [selectedId, activePage],
  );

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

  const handlePageChange = useCallback((id: FigPageId) => {
    setActivePageId(id);
  }, []);
  const handlePageSelectChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setActivePageId(toPageId(event.target.value));
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
      const lineHeight = 16;
      const pageHeight = rect.height || 1;
      let dx = event.deltaX;
      let dy = event.deltaY;
      if (event.deltaMode === 1) {dx *= lineHeight; dy *= lineHeight;}
      else if (event.deltaMode === 2) {dx *= pageHeight; dy *= pageHeight;}

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const current = viewportRef.current;
        const factor = Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY);
        const next = clampZoom(current.scale * factor);
        if (next === current.scale) {return;}
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        commitViewport(rescaleAround(current, next, cx, cy));
        return;
      }
      // Plain wheel = pan. preventDefault stops the surrounding page
      // from scrolling (the stage container itself has no scrollbars).
      event.preventDefault();
      const current = viewportRef.current;
      commitViewport({
        ...current,
        translateX: current.translateX - dx,
        translateY: current.translateY - dy,
      });
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
        if (!pan.moved && Math.hypot(dx, dy) > PAN_MOVE_THRESHOLD) {
          pan.moved = true;
        }
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
      if (!point) {
        setSelectedId(null);
        return;
      }
      const hit = findNodeAtPoint(nodeBounds, point);
      setSelectedId(hit ? hit.id : null);
    },
    [cursorToPagePoint, nodeBounds, spacePan],
  );

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExport = useCallback(
    async (request: ExportRequest) => {
      if (!activePage || !selectedFigNode) {
        setExportError("Select a layer to export.");
        return;
      }
      setExporting(true);
      setExportError(null);
      try {
        const rendered = await renderNodeToSvg({
          document,
          page: activePage,
          node: selectedFigNode,
          renderOptions,
          textFontResolver,
        });
        if (request.format === "SVG") {
          const blob = new Blob([rendered.svgString], { type: "image/svg+xml;charset=utf-8" });
          triggerBlobDownload(
            blob,
            buildExportFileName({
              baseName: request.baseName,
              suffix: request.suffix,
              extension: "svg",
            }),
          );
          return;
        }
        const blob = await rasterizeSvg({
          svgString: rendered.svgString,
          width: rendered.width,
          height: rendered.height,
          scale: request.scale,
          format: request.format,
        });
        triggerBlobDownload(
          blob,
          buildExportFileName({
            baseName: request.baseName,
            suffix: request.suffix,
            extension: request.format === "PNG" ? "png" : "jpg",
          }),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setExportError(message);
      } finally {
        setExporting(false);
      }
    },
    [activePage, selectedFigNode, document, renderOptions, textFontResolver],
  );

  return (
    <div className="higma-fig-app">
      <div className="higma-fig-toolbar" role="toolbar" aria-label="Fig viewer controls">
        <span className="higma-fig-toolbar__filename" title={fileName}>
          {fileName}
        </span>
        {document.pages.length > 1 && (
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
              {document.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
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
          document={document}
          activePage={activePage}
          activePageId={activePageId}
          onPageChange={handlePageChange}
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={setSelectedId}
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
            hasContent={pageBounds !== null}
            viewport={viewport}
            surface={stageSize}
            images={document.images}
            blobs={document.blobs}
            symbolMap={document.components}
            styleRegistry={document.styleRegistry}
            renderOptions={renderOptions}
            textFontResolver={textFontResolver}
            hoveredNode={hoveredNode}
            selectedNode={selectedNode}
            canvasRef={canvasRef}
          />
        </div>
        <InspectPanel
          document={document}
          page={activePage}
          selectedNode={selectedFigNode}
          selectedBounds={selectedNode}
          onExport={(req) => void handleExport(req)}
          exporting={exporting}
          exportError={exportError}
        />
      </div>
      {hoveredNode && cursor && <HoverTooltip node={hoveredNode} cursor={cursor} />}
    </div>
  );
}

type FigStageContentProps = {
  readonly page: FigPage | null;
  /** True when the page has at least one renderable child. */
  readonly hasContent: boolean;
  readonly viewport: ViewportTransform;
  /** CSS-pixel size of the visible stage. Drives surface + render-window sizing. */
  readonly surface: Size;
  readonly images: FigDesignDocument["images"];
  readonly blobs: FigDesignDocument["blobs"];
  readonly symbolMap: FigDesignDocument["components"];
  readonly styleRegistry: FigDesignDocument["styleRegistry"];
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly textFontResolver: ReturnType<typeof createCanvasMetricsTextFontResolver>;
  readonly hoveredNode: NodeBounds | null;
  readonly selectedNode: NodeBounds | null;
  readonly canvasRef: React.RefObject<HTMLDivElement | null>;
};

const MIN_RENDER_DIM = 1;

function FigStageContent({
  page,
  hasContent,
  viewport,
  surface,
  images,
  blobs,
  symbolMap,
  styleRegistry,
  renderOptions,
  textFontResolver,
  hoveredNode,
  selectedNode,
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
    images,
    blobs,
    symbolMap,
    styleRegistry,
    textFontResolver,
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
        selected={selectedNode}
      />
    </div>
  );
}

const DESIGN_NODE_DFS_OPTIONS = {
  getId: (node: FigDesignNode) => node.id as string,
  getChildren: (node: FigDesignNode): readonly FigDesignNode[] => node.children ?? [],
} as const;

function findNodeInPage(nodes: readonly FigDesignNode[], id: FigNodeId): FigDesignNode | null {
  return dfsById(nodes, id as string, DESIGN_NODE_DFS_OPTIONS) ?? null;
}
