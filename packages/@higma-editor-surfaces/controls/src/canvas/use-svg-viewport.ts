/**
 * @file SVG viewport hook
 *
 * Manages viewport transform state for pan/zoom interactions.
 *
 * SoT contract: the returned `view` (containing `viewport` and
 * `viewportSize`) is the single source of truth for the displayed canvas
 * viewbox. Storing both fields inside one `useState` means that any
 * change that affects both — e.g. a resize that requires a fit-mode
 * refit, where the new size and the new viewport must be coherent —
 * commits in a single render. Consumers reading both fields therefore
 * never observe a one-render "tearing" window where size is new but
 * viewport still reflects the previous layout, so they don't need
 * `useTransition` or other deferred-render workarounds to mask the gap.
 *
 * - `zoomMode === "fit"` is an intent flag that requests re-fitting on
 *   resize. The resize callback re-fits atomically with the size update;
 *   external zoomMode changes flow through a separate sync effect.
 * - Any user-initiated pan or wheel-zoom mutates state directly. If
 *   fit mode is active, those interactions also exit fit mode (via
 *   `onZoomModeChange`) so the next resize no longer overrides the
 *   user's manual placement.
 * - External numeric zoomMode changes apply zoom-toward-centre (a no-op
 *   when the state's scale already matches the requested zoomMode,
 *   which keeps wheel-zoom echoes from double-transforming).
 */

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
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

/**
 * The canvas viewbox: pan/zoom transform and the underlying viewport
 * dimensions. Held as a single React state to guarantee atomic updates
 * across fields (see file header).
 */
export type CanvasViewState = {
  readonly viewport: ViewportTransform;
  readonly viewportSize: ViewportSize;
};

const INITIAL_CANVAS_VIEW: CanvasViewState = {
  viewport: INITIAL_VIEWPORT,
  viewportSize: { width: 0, height: 0 },
};

export type UseSvgViewportResult = {
  /** Ref to attach to the SVG element */
  readonly svgRef: RefObject<SVGSVGElement | null>;
  /** Canvas viewbox state — single object, atomic per commit. */
  readonly view: CanvasViewState;
  /** Convenience accessor for `view.viewport`. */
  readonly viewport: ViewportTransform;
  /** Convenience accessor for `view.viewportSize`. */
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

function resolveViewportForZoomMode({
  zoomMode,
  viewportSize,
  slideSize,
  rulerThickness,
  placement,
  margin,
}: {
  readonly zoomMode: ZoomMode;
  readonly viewportSize: ViewportSize;
  readonly slideSize: SlideSize;
  readonly rulerThickness: number;
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
  const [view, setView] = useState<CanvasViewState>(INITIAL_CANVAS_VIEW);
  const { viewport, viewportSize } = view;
  const [isPanning, setIsPanning] = useState(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  // Tracks the last zoomMode the hook has aligned the viewport state to.
  // Distinguishes an *external* zoomMode change (caller used the dropdown
  // or fit-to-view button — we must update viewport) from an *echo* of our
  // own onZoomModeChange call (we already updated viewport, so re-running
  // would double-transform).
  const syncedZoomModeRef = useRef<ZoomMode | null>(null);
  // Latest props mirror, so the resize callback (created once) can read
  // the current zoomMode / slideSize / rulerThickness / placement /
  // margin without being re-bound and without forcing the observer to
  // tear down on every render.
  const layoutPropsRef = useRef({
    zoomMode,
    slideSize,
    rulerThickness,
    initialViewportPlacement,
    initialViewportMargin,
  });
  layoutPropsRef.current = {
    zoomMode,
    slideSize,
    rulerThickness,
    initialViewportPlacement,
    initialViewportMargin,
  };

  // Resolve clamp function: default = standard slide clamping
  const defaultClampFn = useCallback(
    (vp: ViewportTransform) => clampViewport({ viewport: vp, viewportSize, slideSize, rulerThickness }),
    [viewportSize, slideSize, rulerThickness],
  );
  const applyClamp = clampFnProp ?? defaultClampFn;

  // Report display zoom changes — derived purely from state.
  useLayoutEffect(() => {
    onDisplayZoomChange?.(viewport.scale);
  }, [viewport.scale, onDisplayZoomChange]);

  // Observe SVG size. Updates the view state atomically: when the size
  // changes, also re-derive the viewport if needed (initial placement on
  // first-non-zero size, re-fit on resize while in fit mode). Bundling
  // these into a single `setView` call eliminates the cross-render
  // tearing where size would be new but viewport still old for one
  // commit.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const updateSize = () => {
      const rect = svg.getBoundingClientRect();
      setView((prev) => {
        if (
          prev.viewportSize.width === rect.width
          && prev.viewportSize.height === rect.height
        ) {
          return prev;
        }
        const nextSize: ViewportSize = { width: rect.width, height: rect.height };
        if (nextSize.width <= 0 || nextSize.height <= 0) {
          return { ...prev, viewportSize: nextSize };
        }
        const isFirstSize =
          prev.viewportSize.width === 0 || prev.viewportSize.height === 0;
        const layout = layoutPropsRef.current;
        if (!isFirstSize && !isFitMode(layout.zoomMode)) {
          // Fixed zoom + later resize: preserve user's pan/zoom state.
          return { ...prev, viewportSize: nextSize };
        }
        // First placement OR fit-mode re-fit: derive viewport from new size.
        syncedZoomModeRef.current = layout.zoomMode;
        const nextViewport = resolveViewportForZoomMode({
          zoomMode: layout.zoomMode,
          viewportSize: nextSize,
          slideSize: layout.slideSize,
          rulerThickness: layout.rulerThickness,
          placement: layout.initialViewportPlacement ?? "center",
          margin: layout.initialViewportMargin ?? 40,
        });
        return { viewport: nextViewport, viewportSize: nextSize };
      });
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    updateSize();

    return () => observer.disconnect();
  }, []);

  // Synchronise viewport state to *external* zoomMode prop changes.
  // (Resize is handled in the observer callback above; this effect only
  // handles "the consumer changed zoomMode".)
  //
  // The setView updater compares against `prev` and returns it unchanged
  // when nothing must move, because callers commonly re-create option
  // objects every render — without the guard the effect would loop on
  // every parent re-render.
  useLayoutEffect(() => {
    setView((prev) => {
      if (prev.viewportSize.width === 0 || prev.viewportSize.height === 0) {
        // Initial placement happens in the resize observer once size arrives.
        return prev;
      }
      const previousSynced = syncedZoomModeRef.current;
      if (previousSynced === zoomMode) {
        return prev;
      }
      syncedZoomModeRef.current = zoomMode;
      if (isFitMode(zoomMode)) {
        const nextViewport = resolveViewportForZoomMode({
          zoomMode,
          viewportSize: prev.viewportSize,
          slideSize,
          rulerThickness,
          placement: initialViewportPlacement,
          margin: initialViewportMargin,
        });
        if (
          nextViewport.scale === prev.viewport.scale
          && nextViewport.translateX === prev.viewport.translateX
          && nextViewport.translateY === prev.viewport.translateY
        ) {
          return prev;
        }
        return { ...prev, viewport: nextViewport };
      }
      // External change to a fixed scale: zoom toward the visible centre.
      // When the change is an echo of our own wheel-zoom call, the state's
      // scale already matches zoomMode, so zoomTowardCursor returns the
      // input unchanged — no double-transform.
      if (prev.viewport.scale === zoomMode) {
        return prev;
      }
      const availableWidth = prev.viewportSize.width - rulerThickness;
      const availableHeight = prev.viewportSize.height - rulerThickness;
      const centerX = availableWidth / 2;
      const centerY = availableHeight / 2;
      const nextViewport = zoomTowardCursor({
        viewport: prev.viewport,
        cursorX: centerX,
        cursorY: centerY,
        newScale: zoomMode,
      });
      return { ...prev, viewport: nextViewport };
    });
  }, [
    zoomMode,
    slideSize,
    rulerThickness,
    initialViewportPlacement,
    initialViewportMargin,
  ]);

  // When the user actively pans, ensure we leave fit mode so the next resize
  // does not snap the canvas back to the fitted placement.
  const exitFitModeIfNeeded = useCallback(
    (currentScale: number) => {
      if (!isFitMode(zoomMode)) {
        return;
      }
      // Pre-record alignment so the responding effect run treats this as
      // an echo (no-op) rather than as an external mode-change that would
      // zoom-to-centre on top of our pan.
      syncedZoomModeRef.current = currentScale;
      onZoomModeChange?.(currentScale);
    },
    [zoomMode, onZoomModeChange],
  );

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

        const direction = e.deltaY < 0 ? "in" : "out";
        // viewport.scale is the *displayed* scale by SoT (no divergence
        // from an effectiveViewport derivation). Closure reads the latest
        // committed state.
        const newScale = getNextZoomValue(viewport.scale, direction);

        // Pre-record alignment so the consumer's echo of onZoomModeChange
        // doesn't trigger zoom-toward-centre on top of zoom-toward-cursor.
        syncedZoomModeRef.current = newScale;
        onZoomModeChange?.(newScale);

        setView((prev) => ({
          ...prev,
          viewport: zoomTowardCursor({
            viewport: prev.viewport,
            cursorX: cursorPos.x,
            cursorY: cursorPos.y,
            newScale,
          }),
        }));
      } else {
        // Pan mode: scroll for vertical, Shift+scroll for horizontal
        e.preventDefault();

        // Shift swaps the delta direction (horizontal scroll)
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ? -e.deltaX : -e.deltaY;

        setView((prev) => ({
          ...prev,
          viewport: applyClamp(panViewport(prev.viewport, dx, dy)),
        }));
        exitFitModeIfNeeded(viewport.scale);
      }
    },
    [viewport.scale, onZoomModeChange, rulerThickness, applyClamp, exitFitModeIfNeeded],
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

      setView((prev) => ({
        ...prev,
        viewport: applyClamp(panViewport(prev.viewport, dx, dy)),
      }));
      exitFitModeIfNeeded(viewport.scale);
    },
    [isPanning, applyClamp, exitFitModeIfNeeded, viewport.scale],
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Center viewport — preserve current scale, recompute translation.
  const centerViewport = useCallback(() => {
    setView((prev) => {
      const centered = getCenteredViewport({
        viewportSize: prev.viewportSize,
        slideSize,
        scale: prev.viewport.scale,
        rulerThickness,
      });
      return {
        ...prev,
        viewport: {
          translateX: centered.translateX,
          translateY: centered.translateY,
          scale: prev.viewport.scale,
        },
      };
    });
  }, [slideSize, rulerThickness]);

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
    view,
    viewport,
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
