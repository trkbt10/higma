/**
 * @file Top-level viewer: 3-pane layout (Layers | Stage | Inspect)
 * with shared selection, hover, and zoom state.
 *
 * The viewer owns:
 *   - the active page selection
 *   - the hovered and selected node ids
 *   - the zoom state (fit + manual modes)
 *   - the export request state (busy + error message)
 *
 * Hit-testing happens on the canvas via mousemove → page-coord
 * conversion → `findNodeAtPoint`. The layers panel and inspect panel
 * read the same selected/hovered ids so all three views stay
 * coherent without an extra synchronisation layer.
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

type FigViewerProps = {
  readonly fileName: string;
  readonly document: FigDesignDocument;
};

type ZoomMode =
  | { readonly kind: "fit" }
  | { readonly kind: "manual"; readonly value: number };

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

  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit" });
  const [stageSize, setStageSize] = useState<{ readonly width: number; readonly height: number }>({
    width: 0,
    height: 0,
  });

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

  const fitZoom = useMemo(() => {
    if (!pageBounds || stageSize.width <= 0 || stageSize.height <= 0) {return 1;}
    const availableWidth = Math.max(1, stageSize.width - FIT_PADDING * 2);
    const availableHeight = Math.max(1, stageSize.height - FIT_PADDING * 2);
    const ratio = Math.min(availableWidth / pageBounds.width, availableHeight / pageBounds.height);
    return clampZoom(ratio);
  }, [pageBounds, stageSize]);

  const effectiveZoom = zoomMode.kind === "fit" ? fitZoom : zoomMode.value;

  const handleZoomIn = useCallback(() => {
    setZoomMode((prev) => {
      const base = prev.kind === "fit" ? fitZoom : prev.value;
      return { kind: "manual", value: nextZoomLevel(base, 1) };
    });
  }, [fitZoom]);
  const handleZoomOut = useCallback(() => {
    setZoomMode((prev) => {
      const base = prev.kind === "fit" ? fitZoom : prev.value;
      return { kind: "manual", value: nextZoomLevel(base, -1) };
    });
  }, [fitZoom]);
  const handleFit = useCallback(() => setZoomMode({ kind: "fit" }), []);
  const handleResetZoom = useCallback(() => setZoomMode({ kind: "manual", value: 1 }), []);

  const handlePageChange = useCallback((id: FigPageId) => {
    setActivePageId(id);
  }, []);
  const handlePageSelectChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setActivePageId(toPageId(event.target.value));
  }, []);

  const cursorToPagePoint = useCallback(
    (clientX: number, clientY: number): { readonly x: number; readonly y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas || !pageBounds) {return null;}
      const rect = canvas.getBoundingClientRect();
      const localX = (clientX - rect.left) / effectiveZoom;
      const localY = (clientY - rect.top) / effectiveZoom;
      return { x: localX + pageBounds.x, y: localY + pageBounds.y };
    },
    [pageBounds, effectiveZoom],
  );

  const handleStageMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setCursor({ x: event.clientX, y: event.clientY });
      const point = cursorToPagePoint(event.clientX, event.clientY);
      if (!point) {
        setHoveredId(null);
        return;
      }
      const hit = findNodeAtPoint(nodeBounds, point);
      setHoveredId(hit ? hit.id : null);
    },
    [cursorToPagePoint, nodeBounds],
  );

  const handleStageMouseLeave = useCallback(() => {
    setHoveredId(null);
    setCursor(null);
  }, []);

  const handleStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const point = cursorToPagePoint(event.clientX, event.clientY);
      if (!point) {
        setSelectedId(null);
        return;
      }
      const hit = findNodeAtPoint(nodeBounds, point);
      setSelectedId(hit ? hit.id : null);
    },
    [cursorToPagePoint, nodeBounds],
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
            {Math.round(effectiveZoom * 100)}%
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
            aria-pressed={zoomMode.kind === "fit"}
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
          onMouseMove={handleStageMouseMove}
          onMouseLeave={handleStageMouseLeave}
          onClick={handleStageClick}
        >
          <FigStageContent
            page={activePage}
            bounds={pageBounds}
            effectiveZoom={effectiveZoom}
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
  readonly bounds: PageBounds | null;
  readonly effectiveZoom: number;
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

function FigStageContent({
  page,
  bounds,
  effectiveZoom,
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
  // The scene graph is built unconditionally so React still has a
  // stable hook order across "no page" and "ready" states. When
  // there is no page, the hook returns null and the WebGL viewport
  // skips renderer initialisation.
  const sceneGraph = useFigSceneGraph({
    page,
    canvasWidth: bounds?.width ?? 0,
    canvasHeight: bounds?.height ?? 0,
    viewportX: bounds?.x ?? 0,
    viewportY: bounds?.y ?? 0,
    viewportWidth: bounds?.width ?? 0,
    viewportHeight: bounds?.height ?? 0,
    images,
    blobs,
    symbolMap,
    styleRegistry,
    textFontResolver,
  });

  if (!page || !bounds) {
    return <div className="higma-fig-status">This file does not contain any pages to render.</div>;
  }
  const cssWidth = bounds.width * effectiveZoom;
  const cssHeight = bounds.height * effectiveZoom;
  return (
    <div
      className="higma-fig-canvas"
      ref={canvasRef}
      style={{ width: cssWidth, height: cssHeight }}
    >
      {/* The WebGL renderer paints at logical (un-zoomed) CSS px and
       *  imperatively sets the canvas's inline width/height. We honour
       *  that contract by sizing the inner wrapper to the logical
       *  bounds and applying zoom via CSS transform — the same pattern
       *  the SVG renderer used. */}
      <div
        className="higma-fig-canvas__inner"
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `scale(${effectiveZoom})`,
          transformOrigin: "0 0",
        }}
      >
        <WebGLViewport
          sceneGraph={sceneGraph}
          renderOptions={renderOptions}
          viewportScale={effectiveZoom}
        />
      </div>
      <HoverOverlay
        pageBounds={bounds}
        zoom={effectiveZoom}
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
