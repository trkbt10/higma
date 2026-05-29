/** @file Tests for WebGL viewport-motion redraw regions. */

import {
  resolveScaledViewportMotionRedrawRegion,
  resolveViewportMotionRedrawRegion,
} from "./viewport-motion-redraw-region";

describe("resolveViewportMotionRedrawRegion", () => {
  it("copies the overlapping framebuffer region and redraws newly exposed top and left strips", () => {
    expect(resolveViewportMotionRedrawRegion({
      previousViewport: { x: -1181.651612903226, y: -1181.651612903226, width: 17232.41935483871, height: 16518.50483870968 },
      currentViewport: { x: -7089.909677419355, y: -4135.7806451612905, width: 17232.41935483871, height: 16518.50483870968 },
      surfaceWidth: 700,
      surfaceHeight: 671,
      pixelRatio: 1,
    })).toEqual({
      sourceRegion: { x: 0, y: 120, width: 460, height: 551 },
      targetRegion: { x: 240, y: 0, width: 460, height: 551 },
      exposedViewportRegions: [
        { x: 0, y: 0, width: 240, height: 671 },
        { x: 240, y: 0, width: 460, height: 120 },
      ],
    });
  });

  it("copies the overlapping framebuffer region and redraws newly exposed bottom and right strips", () => {
    expect(resolveViewportMotionRedrawRegion({
      previousViewport: { x: 10, y: 10, width: 100, height: 100 },
      currentViewport: { x: 20, y: 30, width: 100, height: 100 },
      surfaceWidth: 200,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toEqual({
      sourceRegion: { x: 20, y: 0, width: 180, height: 80 },
      targetRegion: { x: 0, y: 20, width: 180, height: 80 },
      exposedViewportRegions: [
        { x: 180, y: 0, width: 20, height: 100 },
        { x: 0, y: 80, width: 180, height: 20 },
      ],
    });
  });

  it("returns null when viewport scale changes", () => {
    expect(resolveViewportMotionRedrawRegion({
      previousViewport: { x: 0, y: 0, width: 100, height: 100 },
      currentViewport: { x: 0, y: 0, width: 50, height: 100 },
      surfaceWidth: 200,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toBeNull();
  });

  it("returns null when the pan has no framebuffer overlap", () => {
    expect(resolveViewportMotionRedrawRegion({
      previousViewport: { x: 0, y: 0, width: 100, height: 100 },
      currentViewport: { x: 100, y: 0, width: 100, height: 100 },
      surfaceWidth: 200,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toBeNull();
  });
});

describe("resolveScaledViewportMotionRedrawRegion", () => {
  it("magnifies the cache sub-rect onto the full output when zooming in", () => {
    expect(resolveScaledViewportMotionRedrawRegion({
      previousViewport: { x: 0, y: 0, width: 100, height: 100 },
      currentViewport: { x: 25, y: 25, width: 50, height: 50 },
      surfaceWidth: 100,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toEqual({
      sourceRegion: { x: 25, y: 25, width: 50, height: 50 },
      targetRegion: { x: 0, y: 0, width: 100, height: 100 },
      needsBackgroundClear: false,
    });
  });

  it("shrinks the whole cache toward the output centre and flags a clear when zooming out", () => {
    expect(resolveScaledViewportMotionRedrawRegion({
      previousViewport: { x: 25, y: 25, width: 50, height: 50 },
      currentViewport: { x: 0, y: 0, width: 100, height: 100 },
      surfaceWidth: 100,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toEqual({
      sourceRegion: { x: 0, y: 0, width: 100, height: 100 },
      targetRegion: { x: 25, y: 25, width: 50, height: 50 },
      needsBackgroundClear: true,
    });
  });

  it("returns null when the zoomed viewport shares no area with the cache", () => {
    expect(resolveScaledViewportMotionRedrawRegion({
      previousViewport: { x: 0, y: 0, width: 10, height: 10 },
      currentViewport: { x: 100, y: 100, width: 5, height: 5 },
      surfaceWidth: 100,
      surfaceHeight: 100,
      pixelRatio: 1,
    })).toBeNull();
  });
});
