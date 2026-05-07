/**
 * @file Main React component for the Higma `.fig` viewer webview.
 *
 * Receives a `LoadedFigDocument` (already-decoded fig domain document)
 * and renders the selected page through the shared
 * `FigFamilyPageRenderer`. Provides a VS Code-themed toolbar with page
 * selection, zoom controls, and a fit-to-window action.
 *
 * UI styling relies entirely on `--vscode-*` CSS custom properties so
 * the viewer adapts to the active editor theme without per-theme code.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FigDesignDocument, FigPageId } from "@higma-document-models/fig/domain";
import { toPageId } from "@higma-document-models/fig/domain";
import { FigFamilyPageRenderer, createFigFamilyRenderOptions } from "@higma-figma-runtime/react-renderer";
import { createCanvasMetricsTextFontResolver } from "@higma-document-renderers/fig/font-drivers/browser";
import { computePageBounds } from "./page-bounds";

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

function clampZoom(value: number): number {
  if (value < MIN_ZOOM) {
    return MIN_ZOOM;
  }
  if (value > MAX_ZOOM) {
    return MAX_ZOOM;
  }
  return value;
}

function nextZoomLevel(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const above = ZOOM_LEVELS.find((level) => level > current + 0.0001);
    if (above === undefined) {
      return MAX_ZOOM;
    }
    return above;
  }
  const reversedLevels = ZOOM_LEVELS.slice().reverse();
  const below = reversedLevels.find((level) => level < current - 0.0001);
  if (below === undefined) {
    return MIN_ZOOM;
  }
  return below;
}

/**
 * Top-level viewer component.
 *
 * The component owns:
 *   - the currently selected page (defaulting to the first page that
 *     has children, falling back to page index 0),
 *   - the zoom state (a "fit" mode that tracks the stage size, plus a
 *     manual mode for user-driven zoom levels).
 */
export function FigViewer({ fileName, document }: FigViewerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  const initialPageId = useMemo<FigPageId | null>(() => {
    const withChildren = document.pages.find((page) => page.children.length > 0);
    const target = withChildren ?? document.pages[0];
    return target ? target.id : null;
  }, [document]);

  const [activePageId, setActivePageId] = useState<FigPageId | null>(initialPageId);
  useEffect(() => {
    setActivePageId(initialPageId);
  }, [initialPageId]);

  const activePage = useMemo(() => {
    if (!activePageId) {
      return null;
    }
    return document.pages.find((page) => page.id === activePageId) ?? null;
  }, [activePageId, document]);

  const bounds = useMemo(() => {
    if (!activePage) {
      return null;
    }
    return computePageBounds(activePage.children);
  }, [activePage]);

  const renderOptions = useMemo(() => createFigFamilyRenderOptions(document), [document]);
  const textFontResolver = useMemo(() => createCanvasMetricsTextFontResolver(), []);

  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit" });
  const [stageSize, setStageSize] = useState<{ readonly width: number; readonly height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setStageSize({ width, height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fitZoom = useMemo(() => {
    if (!bounds || stageSize.width <= 0 || stageSize.height <= 0) {
      return 1;
    }
    const availableWidth = Math.max(1, stageSize.width - FIT_PADDING * 2);
    const availableHeight = Math.max(1, stageSize.height - FIT_PADDING * 2);
    const ratio = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    return clampZoom(ratio);
  }, [bounds, stageSize]);

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

  const handleFit = useCallback(() => {
    setZoomMode({ kind: "fit" });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomMode({ kind: "manual", value: 1 });
  }, []);

  const handlePageChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setActivePageId(toPageId(event.target.value));
  }, []);

  const symbolMap = document.components;
  const styleRegistry = document.styleRegistry;
  const images = document.images;
  const blobs = document.blobs;

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
              onChange={handlePageChange}
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
      <div className="higma-fig-stage" ref={stageRef}>
        <FigStageContent
          page={activePage}
          bounds={bounds}
          effectiveZoom={effectiveZoom}
          images={images}
          blobs={blobs}
          symbolMap={symbolMap}
          styleRegistry={styleRegistry}
          renderOptions={renderOptions}
          textFontResolver={textFontResolver}
        />
      </div>
    </div>
  );
}

type FigStageContentProps = {
  readonly page: FigDesignDocument["pages"][number] | null;
  readonly bounds: ReturnType<typeof computePageBounds> | null;
  readonly effectiveZoom: number;
  readonly images: FigDesignDocument["images"];
  readonly blobs: FigDesignDocument["blobs"];
  readonly symbolMap: FigDesignDocument["components"];
  readonly styleRegistry: FigDesignDocument["styleRegistry"];
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly textFontResolver: ReturnType<typeof createCanvasMetricsTextFontResolver>;
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
}: FigStageContentProps) {
  if (!page || !bounds) {
    return <div className="higma-fig-status">This file does not contain any pages to render.</div>;
  }
  return (
    <div
      className="higma-fig-canvas"
      style={{
        width: bounds.width * effectiveZoom,
        height: bounds.height * effectiveZoom,
      }}
    >
      <div
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `scale(${effectiveZoom})`,
          transformOrigin: "0 0",
        }}
      >
        <FigFamilyPageRenderer
          page={page}
          canvasWidth={bounds.width}
          canvasHeight={bounds.height}
          viewportX={bounds.x}
          viewportY={bounds.y}
          viewportWidth={bounds.width}
          viewportHeight={bounds.height}
          images={images}
          blobs={blobs}
          symbolMap={symbolMap}
          styleRegistry={styleRegistry}
          renderOptions={renderOptions}
          textFontResolver={textFontResolver}
        />
      </div>
    </div>
  );
}
