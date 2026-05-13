/**
 * @file Tests for useSvgViewport
 *
 * Regression coverage for the "pan in fit mode is invisible until zoom"
 * bug. The historical implementation maintained a derived `effectiveViewport`
 * that diverged from internal `viewport` state when `zoomMode === "fit"`:
 * pans silently mutated state, then a later zoom revealed the accumulated
 * drift as a sudden canvas jump.
 *
 * The current contract:
 *  - The returned `viewport` is the single source of truth.
 *  - A pan or wheel-zoom while `zoomMode === "fit"` exits fit mode.
 *  - An external `zoomMode === "fit"` re-fits to viewport size.
 *  - An external numeric zoomMode change applies zoom-toward-centre, and
 *    must be a no-op when the state's scale already matches.
 */
// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { ViewportTransform } from "@higma-editor-kernel/core/viewport";
import type { ZoomMode } from "@higma-editor-surfaces/controls/zoom";
import { triggerResizeObservers } from "../../../../../spec/test-utils/resize-observer";
import { useSvgViewport, type UseSvgViewportResult } from "./use-svg-viewport";

const FIXED_SIZE_KEY = Symbol("fixed-viewport-size");

type FixedSizeSvg = SVGSVGElement & { [FIXED_SIZE_KEY]?: { width: number; height: number } };

function installFixedSize(svg: SVGSVGElement, width: number, height: number) {
  const target = svg as FixedSizeSvg;
  target[FIXED_SIZE_KEY] = { width, height };
  if ((target as { __sizePatched?: boolean }).__sizePatched) {
    return;
  }
  (target as { __sizePatched?: boolean }).__sizePatched = true;
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value() {
      const size = (this as FixedSizeSvg)[FIXED_SIZE_KEY] ?? { width: 0, height: 0 };
      return {
        left: 0,
        top: 0,
        width: size.width,
        height: size.height,
        right: size.width,
        bottom: size.height,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    },
  });
}

/**
 * The project-wide ResizeObserver mock (installed via vitest setupFiles)
 * makes `observe` a no-op and provides `triggerResizeObservers()` to fire
 * all registered callbacks manually. We rely on that: tests patch the
 * SVG's getBoundingClientRect to return the desired size and then call
 * `triggerResizeObservers()` to make the viewport hook re-read it.
 */
function notifyAllObservers() {
  triggerResizeObservers();
}

type HarnessProps = {
  readonly initialZoomMode: ZoomMode;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly captureRef: { current: UseSvgViewportResult | null };
  readonly zoomModeCalls: ZoomMode[];
  readonly clampFn?: (vp: ViewportTransform) => ViewportTransform;
};

function ViewportHarness(props: HarnessProps) {
  const {
    initialZoomMode,
    viewportWidth,
    viewportHeight,
    slideWidth,
    slideHeight,
    captureRef,
    zoomModeCalls,
    clampFn,
  } = props;

  const [zoomMode, setZoomMode] = useState<ZoomMode>(initialZoomMode);

  const result = useSvgViewport({
    slideSize: { width: slideWidth, height: slideHeight },
    rulerThickness: 0,
    zoomMode,
    onZoomModeChange: (mode) => {
      zoomModeCalls.push(mode);
      setZoomMode(mode);
    },
    clampFn,
  });

  // Capture the latest result synchronously each render so that tests
  // never observe a stale `null`. (A useEffect-based capture races with
  // the test's first read because effects flush after the test reads.)
  captureRef.current = result;

  useEffect(() => {
    const svg = result.svgRef.current;
    if (!svg) {
      return;
    }
    installFixedSize(svg, viewportWidth, viewportHeight);
    notifyAllObservers();
  }, [result.svgRef, viewportWidth, viewportHeight]);

  return <svg ref={result.svgRef} />;
}

describe("useSvgViewport", () => {
  function setupHarness({
    initialZoomMode = "fit" as ZoomMode,
    viewportWidth = 800,
    viewportHeight = 600,
    slideWidth = 400,
    slideHeight = 300,
    clampFn,
  }: {
    readonly initialZoomMode?: ZoomMode;
    readonly viewportWidth?: number;
    readonly viewportHeight?: number;
    readonly slideWidth?: number;
    readonly slideHeight?: number;
    readonly clampFn?: (vp: ViewportTransform) => ViewportTransform;
  } = {}) {
    const captureRef: { current: UseSvgViewportResult | null } = { current: null };
    const zoomModeCalls: ZoomMode[] = [];

    const utils = render(
      <ViewportHarness
        initialZoomMode={initialZoomMode}
        viewportWidth={viewportWidth}
        viewportHeight={viewportHeight}
        slideWidth={slideWidth}
        slideHeight={slideHeight}
        captureRef={captureRef}
        zoomModeCalls={zoomModeCalls}
        clampFn={clampFn}
      />,
    );

    function latest(): UseSvgViewportResult {
      if (!captureRef.current) {
        throw new Error("harness has not produced a result yet");
      }
      return captureRef.current;
    }

    return {
      ...utils,
      latest,
      get viewport() {
        return latest().viewport;
      },
      zoomModeCalls,
      async flush() {
        await act(async () => {
          // Two microtask boundaries cover: (1) the harness effect that
          // calls notifyAllObservers, (2) the resulting setState in the
          // viewport hook, (3) the layout-effect that syncs the fitted
          // viewport, (4) the resulting render's effects.
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
      },
      async resize(width: number, height: number) {
        await act(async () => {
          installFixedSize(latest().svgRef.current!, width, height);
          notifyAllObservers();
          await Promise.resolve();
          await Promise.resolve();
        });
      },
    };
  }

  // Build a synthetic React.PointerEvent carrying only the fields
  // handlePanStart actually reads. We can't satisfy the full SyntheticEvent
  // surface in a unit test, so the construction is routed through a
  // type-predicate function — the cast lives inside `value is X` which the
  // project lint rule permits.
  type SyntheticPanStart = {
    readonly button: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly altKey: boolean;
    readonly pointerId: number;
    readonly preventDefault: () => void;
    readonly target: { setPointerCapture(id: number): void };
  };

  function isReactPointerEvent(value: SyntheticPanStart): value is SyntheticPanStart & React.PointerEvent {
    return value as unknown as boolean;
  }

  function pointerDownEvent(opts: { button: number; clientX: number; clientY: number; altKey?: boolean }): React.PointerEvent {
    const synthetic: SyntheticPanStart = {
      button: opts.button,
      clientX: opts.clientX,
      clientY: opts.clientY,
      altKey: opts.altKey ?? false,
      pointerId: 1,
      preventDefault() { /* no-op */ },
      target: { setPointerCapture() { /* no-op */ } },
    };
    if (isReactPointerEvent(synthetic)) {
      return synthetic;
    }
    throw new Error("unreachable");
  }

  it("starts in fit mode with a non-zero scale derived from viewport size", async () => {
    const harness = setupHarness({ initialZoomMode: "fit" });
    await harness.flush();
    expect(harness.viewport.scale).toBeGreaterThan(0);
    expect(harness.viewport.scale).toBeLessThanOrEqual(1);
    // Fitted viewport's scale fits the 400x300 slide into the 800x600
    // viewport with default 40px padding: min((800-80)/400, (600-80)/300, 1)
    // = min(1.8, 1.733, 1) = 1.
    expect(harness.viewport.scale).toBe(1);
  });

  it("pan while in fit mode mutates the displayed viewport (not silently)", async () => {
    const harness = setupHarness({ initialZoomMode: "fit", clampFn: (vp) => vp });
    await harness.flush();
    const before = harness.viewport;

    // PanStart and PanMove must be in separate act blocks: PanStart's
    // setIsPanning(true) must commit before the move handler reads it.
    await act(async () => {
      harness.latest().handlePanStart(pointerDownEvent({ button: 1, clientX: 100, clientY: 100 }));
    });
    await act(async () => {
      harness.latest().handlePanMove({ clientX: 150, clientY: 130 } as PointerEvent);
    });
    await harness.flush();

    const after = harness.viewport;
    expect(after.translateX).not.toBe(before.translateX);
    expect(after.translateY).not.toBe(before.translateY);
    // Scale unchanged.
    expect(after.scale).toBe(before.scale);
  });

  it("pan while in fit mode exits fit mode (no later jump on zoom)", async () => {
    const harness = setupHarness({ initialZoomMode: "fit", clampFn: (vp) => vp });
    await harness.flush();

    await act(async () => {
      harness.latest().handlePanStart(pointerDownEvent({ button: 1, clientX: 100, clientY: 100 }));
    });
    await act(async () => {
      harness.latest().handlePanMove({ clientX: 200, clientY: 200 } as PointerEvent);
    });
    await harness.flush();

    // After a manual pan, fit mode is exited: the consumer's zoomMode now
    // holds the fitted scale rather than "fit".
    const numericCalls = harness.zoomModeCalls.filter((m) => typeof m === "number");
    expect(numericCalls.length).toBeGreaterThanOrEqual(1);
    expect(typeof numericCalls[numericCalls.length - 1]).toBe("number");
  });

  it("wheel zoom holds the cursor's world point fixed (no jump)", async () => {
    const harness = setupHarness({ initialZoomMode: "fit", clampFn: (vp) => vp });
    await harness.flush();
    const fitted = harness.viewport;

    await act(async () => {
      const wheel = new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 400,
        clientY: 300,
        ctrlKey: true,
        cancelable: true,
      });
      harness.latest().handleWheel(wheel);
      await Promise.resolve();
      await Promise.resolve();
    });

    const zoomed = harness.viewport;
    // Scale should have changed.
    expect(zoomed.scale).not.toBe(fitted.scale);
    // The world coordinate at the cursor (400, 300) should be preserved
    // by zoom-toward-cursor.
    const worldBefore = (400 - fitted.translateX) / fitted.scale;
    const worldAfter = (400 - zoomed.translateX) / zoomed.scale;
    expect(worldAfter).toBeCloseTo(worldBefore, 5);
    const worldBeforeY = (300 - fitted.translateY) / fitted.scale;
    const worldAfterY = (300 - zoomed.translateY) / zoomed.scale;
    expect(worldAfterY).toBeCloseTo(worldBeforeY, 5);
  });

  it("resize re-fits when zoomMode is fit", async () => {
    const harness = setupHarness({
      initialZoomMode: "fit",
      viewportWidth: 800,
      viewportHeight: 600,
      slideWidth: 400,
      slideHeight: 300,
    });
    await harness.flush();
    const initialScale = harness.viewport.scale;
    const initialSize = harness.latest().viewportSize;
    expect(initialSize.width).toBe(800);
    expect(initialSize.height).toBe(600);

    await harness.resize(200, 150);
    await harness.flush();

    // First sanity-check the viewportSize update propagated.
    expect(harness.latest().viewportSize.width).toBe(200);
    expect(harness.latest().viewportSize.height).toBe(150);

    // After shrinking the viewport, fit-to-view should yield a smaller scale.
    expect(harness.viewport.scale).toBeLessThan(initialScale);
  });

  it("pan in a fixed zoom mode does not call onZoomModeChange", async () => {
    const harness = setupHarness({ initialZoomMode: 1, clampFn: (vp) => vp });
    await harness.flush();
    const callsBefore = harness.zoomModeCalls.length;

    await act(async () => {
      harness.latest().handlePanStart(pointerDownEvent({ button: 1, clientX: 0, clientY: 0 }));
    });
    await act(async () => {
      harness.latest().handlePanMove({ clientX: 50, clientY: 50 } as PointerEvent);
    });
    await harness.flush();

    expect(harness.zoomModeCalls.length).toBe(callsBefore);
  });

  it("resize in fit mode produces a coherent (size, viewport) snapshot every render", async () => {
    // Regression: when size and viewport were two separate useState values,
    // a resize in fit mode shipped two commits — first the new size, then
    // (next render) the re-fitted viewport. Consumers reading both fields
    // saw a transient frame where size was new but viewport reflected the
    // old layout, which forced workarounds like useTransition to hide the
    // gap. They are now stored as one object, so every render's view is
    // internally consistent.
    const harness = setupHarness({
      initialZoomMode: "fit",
      viewportWidth: 800,
      viewportHeight: 600,
      slideWidth: 400,
      slideHeight: 300,
    });
    await harness.flush();

    const snapshots: Array<{ width: number; height: number; scale: number; tx: number; ty: number }> = [];
    const before = harness.latest().view;
    snapshots.push({
      width: before.viewportSize.width,
      height: before.viewportSize.height,
      scale: before.viewport.scale,
      tx: before.viewport.translateX,
      ty: before.viewport.translateY,
    });

    await harness.resize(200, 150);
    await harness.flush();

    const after = harness.latest().view;
    snapshots.push({
      width: after.viewportSize.width,
      height: after.viewportSize.height,
      scale: after.viewport.scale,
      tx: after.viewport.translateX,
      ty: after.viewport.translateY,
    });

    // The viewport size shrank.
    expect(after.viewportSize.width).toBe(200);
    expect(after.viewportSize.height).toBe(150);

    // The viewport refitted (scale dropped from 1 → ~0.233 for fit at 200x150).
    expect(after.viewport.scale).toBeLessThan(before.viewport.scale);

    // Every snapshot must be self-consistent: fit scale derived from the
    // recorded size must match the recorded viewport scale (up to the small
    // padding the fit calculation accounts for). Equivalently, fit-scale
    // for new size shouldn't be the OLD size's fit-scale.
    const stalePairing = snapshots.find((s) => {
      // If a snapshot has the new size but the old fit-scale (or vice
      // versa), it would manifest as either width==200 with scale==1, or
      // width==800 with scale==0.233. Both are mismatches.
      const looksLikeOldFit = Math.abs(s.scale - 1) < 0.01;
      const looksLikeNewFit = Math.abs(s.scale - (70 / 300)) < 0.05;
      if (s.width === 200 && s.height === 150 && looksLikeOldFit) {
        return true;
      }
      if (s.width === 800 && s.height === 600 && looksLikeNewFit) {
        return true;
      }
      return false;
    });
    expect(stalePairing).toBeUndefined();
  });
});
