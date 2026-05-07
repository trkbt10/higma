/**
 * @file SVG viewport hook
 *
 * Manages viewport transform state for pan/zoom interactions.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ViewportTransform, ViewportSize, SlideSize } from "@higma-editor-kernel/core/viewport";
import {
  INITIAL_VIEWPORT,
  getCenteredViewport,
  getNextZoomValue,
  zoomTowardCursor,
  panViewport,
  clampViewport,
  createFittedViewport,
  screenToCanvasCoords,
} from "@higma-editor-kernel/core/viewport";
import { type ZoomMode, isFitMode } from "@higma-editor-surfaces/controls/zoom";

/**
 * Function that adjusts a viewport after panning to enforce boundaries.
 * Returns the clamped viewport.
 *
 * For slide editors: use the default (clampViewport — keeps slide in view).
 * For infinite canvas: pass identity function (no clamping).
 */
export type ViewportClampFn = (viewport: ViewportTransform) => ViewportTransform;

export type InitialViewportPlacement = "center" | "top";

export type UseSvgViewportOptions = {
  /** Canvas content dimensions (for fit-to-view and default clamping) */
  readonly slideSize: SlideSize;
  /** Ruler thickness in pixels */
  readonly rulerThickness: number;
  /** External zoom mode (for controlled mode) */
  readonly zoomMode: ZoomMode;
  /** Callback when zoom mode changes (for controlled mode) */
  readonly onZoomModeChange?: (mode: ZoomMode) => void;
  /** Callback to report current display zoom value (useful when in fit mode) */
  readonly onDisplayZoomChange?: (zoom: number) => void;
  /** Initial content placement inside the visible viewport. */
  readonly initialViewportPlacement?: InitialViewportPlacement;
  /** Viewport margin used when initialViewportPlacement is "top". */
  readonly initialViewportMargin?: number;
  /**
   * Custom viewport clamp function. Called after every pan to enforce boundaries.
   * Default: clampViewport (prevents content from going off-screen).
   * Pass `(v) => v` for infinite canvas (no clamping).
   */
  readonly clampFn?: ViewportClampFn;
};

export type UseSvgViewportResult = {
  /** Ref to attach to the SVG element */
  readonly svgRef: RefObject<SVGSVGElement | null>;
  /** Current viewport transform */
  readonly viewport: ViewportTransform;
  /** Current viewport size */
  readonly viewportSize: ViewportSize;
  /** Handler for wheel events (zoom) */
  readonly handleWheel: (e: WheelEvent) => void;
  /** Handler for pointer down (pan start) */
  readonly handlePanStart: (e: React.PointerEvent) => void;
  /** Handler for pointer move (pan move) */
  readonly handlePanMove: (e: PointerEvent) => void;
  /** Handler for pointer up (pan end) */
  readonly handlePanEnd: () => void;
  /** Whether currently panning */
  readonly isPanning: boolean;
  /** Center the viewport on the slide */
  readonly centerViewport: () => void;
  /** Fit the slide to the viewport */
  readonly fitToView: () => void;
  /** Set zoom level */
  readonly setZoom: (zoom: number) => void;
};

/** Create the first viewport transform for the current controlled zoom mode. */
function createTopAlignedViewport({
  viewportSize,
  slideSize,
  scale,
  rulerThickness,
  margin,
}: {
  readonly viewportSize: ViewportSize;
  readonly slideSize: SlideSize;
  readonly scale: number;
  readonly rulerThickness: number;
  readonly margin: number;
}): ViewportTransform {
  const availableWidth = viewportSize.width - rulerThickness;
  const scaledSlideWidth = slideSize.width * scale;
  return {
    translateX: Math.max(margin, (availableWidth - scaledSlideWidth) / 2),
    translateY: margin,
    scale,
  };
}

function createPlacedViewport({
  viewportSize,
  slideSize,
  scale,
  rulerThickness,
  placement,
  margin,
}: {
  readonly viewportSize: ViewportSize;
  readonly slideSize: SlideSize;
  readonly scale: number;
  readonly rulerThickness: number;
  readonly placement: InitialViewportPlacement;
  readonly margin: number;
}): ViewportTransform {
  if (placement === "top") {
    return createTopAlignedViewport({ viewportSize, slideSize, scale, rulerThickness, margin });
  }
  return getCenteredViewport({ viewportSize, slideSize, scale, rulerThickness });
}

function createInitialViewportForZoomMode({
  viewportSize,
  slideSize,
  rulerThickness,
  zoomMode,
  placement,
  margin,
}: {
  readonly viewportSize: ViewportSize;
  readonly slideSize: SlideSize;
  readonly rulerThickness: number;
  readonly zoomMode: ZoomMode;
  readonly placement: InitialViewportPlacement;
  readonly margin: number;
}): ViewportTransform {
  if (isFitMode(zoomMode)) {
    const fitted = createFittedViewport(viewportSize, slideSize, rulerThickness);
    return createPlacedViewport({
      viewportSize,
      slideSize,
      scale: fitted.scale,
      rulerThickness,
      placement,
      margin,
    });
  }
  return createPlacedViewport({ viewportSize, slideSize, scale: zoomMode, rulerThickness, placement, margin });
}

/**
 * Hook for managing SVG viewport pan/zoom state.
 */
export function useSvgViewport({
  slideSize,
  rulerThickness,
  zoomMode,
  onZoomModeChange,
  onDisplayZoomChange,
  initialViewportPlacement = "center",
  initialViewportMargin = 40,
  clampFn: clampFnProp,
}: UseSvgViewportOptions): UseSvgViewportResult {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<ViewportTransform>(INITIAL_VIEWPORT);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const hasInitializedRef = useRef(false);

  // Resolve clamp function: default = standard slide clamping
  const defaultClampFn = useCallback(
    (vp: ViewportTransform) => clampViewport({ viewport: vp, viewportSize, slideSize, rulerThickness }),
    [viewportSize, slideSize, rulerThickness],
  );
  const applyClamp = clampFnProp ?? defaultClampFn;

  // Calculate fitted viewport for fit mode
  const fittedViewport = useMemo(() => {
    if (viewportSize.width === 0 || viewportSize.height === 0) {
      return INITIAL_VIEWPORT;
    }
    const fitted = createFittedViewport(viewportSize, slideSize, rulerThickness);
    return createPlacedViewport({
      viewportSize,
      slideSize,
      scale: fitted.scale,
      rulerThickness,
      placement: initialViewportPlacement,
      margin: initialViewportMargin,
    });
  }, [viewportSize, slideSize, rulerThickness, initialViewportPlacement, initialViewportMargin]);

  // Determine effective viewport based on zoom mode
  const effectiveViewport = useMemo(() => {
    if (isFitMode(zoomMode)) {
      return fittedViewport;
    }
    return { ...viewport, scale: zoomMode };
  }, [viewport, zoomMode, fittedViewport]);

  // Report display zoom changes
  useLayoutEffect(() => {
    onDisplayZoomChange?.(effectiveViewport.scale);
  }, [effectiveViewport.scale, onDisplayZoomChange]);

  // Update viewport size on resize
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const updateSize = () => {
      const rect = svg.getBoundingClientRect();
      setViewportSize((prev) => {
        if (prev.width === rect.width && prev.height === rect.height) {
          return prev;
        }
        return { width: rect.width, height: rect.height };
      });
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    updateSize();

    return () => observer.disconnect();
  }, []);

  // Initialize viewport translation when viewport size is first available
  useLayoutEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }
    if (viewportSize.width === 0 || viewportSize.height === 0) {
      return;
    }

    setViewport(createInitialViewportForZoomMode({
      viewportSize,
      slideSize,
      rulerThickness,
      zoomMode,
      placement: initialViewportPlacement,
      margin: initialViewportMargin,
    }));

    hasInitializedRef.current = true;
  }, [viewportSize, slideSize, rulerThickness, zoomMode, initialViewportPlacement, initialViewportMargin]);

  // Wheel handler for zoom and scroll-based panning
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const svg = svgRef.current;
      if (!svg) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const zoomModifier = isMac ? e.metaKey : e.ctrlKey;

      if (zoomModifier) {
        // Zoom mode: Ctrl/Cmd + wheel - switches to fixed zoom
        e.preventDefault();

        const rect = svg.getBoundingClientRect();
        const cursorPos = screenToCanvasCoords({
          clientX: e.clientX,
          clientY: e.clientY,
          svgRect: rect,
          rulerThickness,
        });

        const currentScale = effectiveViewport.scale;
        const direction = e.deltaY < 0 ? "in" : "out";
        const newScale = getNextZoomValue(currentScale, direction);

        // Switch to fixed zoom mode
        onZoomModeChange?.(newScale);

        // Update viewport with zoom-toward-cursor
        setViewport((prev) => {
          const currentVp = { ...prev, scale: currentScale };
          return zoomTowardCursor({ viewport: currentVp, cursorX: cursorPos.x, cursorY: cursorPos.y, newScale });
        });
      } else {
        // Pan mode: scroll for vertical, Shift+scroll for horizontal
        e.preventDefault();

        // Shift swaps the delta direction (horizontal scroll)
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? -e.deltaX : -e.deltaY;

        setViewport((prev) => {
          const panned = panViewport(prev, dx, dy);
          return applyClamp(panned);
        });
      }
    },
    [effectiveViewport.scale, onZoomModeChange, rulerThickness, applyClamp],
  );

  // Pan handlers
  const handlePanStart = useCallback((e: React.PointerEvent) => {
    // Middle-click or Alt+left-click to pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const handlePanMove = useCallback(
    (e: PointerEvent) => {
      if (!isPanning) {
        return;
      }

      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      setViewport((prev) => {
        const panned = panViewport(prev, dx, dy);
        return applyClamp(panned);
      });
    },
    [isPanning, applyClamp],
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Center viewport
  const centerViewport = useCallback(() => {
    const fitted = createFittedViewport(viewportSize, slideSize, rulerThickness);
    setViewport((prev) => ({
      translateX: fitted.translateX,
      translateY: fitted.translateY,
      scale: prev.scale,
    }));
  }, [viewportSize, slideSize, rulerThickness]);

  // Fit to view - switches to fit mode
  const fitToView = useCallback(() => {
    onZoomModeChange?.("fit");
  }, [onZoomModeChange]);

  // Set zoom - switches to fixed zoom mode
  const setZoom = useCallback(
    (newZoom: number) => {
      onZoomModeChange?.(newZoom);
    },
    [onZoomModeChange],
  );

  return {
    svgRef,
    viewport: effectiveViewport,
    viewportSize,
    handleWheel,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    centerViewport,
    fitToView,
    setZoom,
  };
}
