/**
 * @file Unit specs for the frameset assembly helpers.
 *
 * The Playwright capture surface is mocked out — only the pure
 * `assembleFramesetSnapshot` and `matchFrame` helpers are exercised.
 * Why those two: every other piece of the frameset pipeline either
 * runs inside the browser (`probeFrameset`) or is a thin Playwright
 * call (`captureFrameContent`); the fragile, host-side coordinate-
 * translation logic is what we keep regression-tested here.
 */
import type { ElementJson, RawSnapshotJson } from "./in-page";
import type { FrameLike } from "./playwright-shared";
import {
  assembleFramesetSnapshot,
  matchFrame,
  type FramesetEntry,
  type FramesetProbe,
} from "./frameset";

function makeJsonEl(id: string, rect = { x: 0, y: 0, width: 100, height: 50 }, children: ElementJson[] = []): ElementJson {
  return {
    id,
    tag: "div",
    rect,
    contentRect: rect,
    visible: true,
    computedStyle: {},
    children,
  };
}

function makeJsonSnapshot(rootRect = { x: 0, y: 0, width: 100, height: 50 }): RawSnapshotJson {
  return {
    source: "https://example.test/inner",
    viewport: rootRect,
    devicePixelRatio: 1,
    background: "rgb(255, 255, 255)",
    root: makeJsonEl("0", rootRect, [makeJsonEl("0/0", { x: 10, y: 5, width: 50, height: 20 })]),
    imageRefs: [],
  };
}

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

const PROBE: FramesetProbe = {
  isFrameset: true,
  framesetBackground: "rgb(240, 240, 240)",
  viewport: VIEWPORT,
  devicePixelRatio: 1,
  source: "https://host.example/",
  frames: [
    {
      id: "0/0/0",
      rect: { x: 0, y: 0, width: 200, height: 600 },
      src: "https://host.example/menu.html",
      name: "menu",
      background: "rgb(255, 255, 255)",
    },
    {
      id: "0/0/1",
      rect: { x: 200, y: 0, width: 600, height: 600 },
      src: "https://host.example/main.html",
      name: "main",
      background: "rgb(255, 255, 255)",
    },
  ],
};

describe("assembleFramesetSnapshot", () => {
  it("wraps the frames under html → frameset → frame elements", () => {
    const snap = assembleFramesetSnapshot(PROBE, [
      { entry: PROBE.frames[0]!, snapshot: makeJsonSnapshot() },
      { entry: PROBE.frames[1]!, snapshot: makeJsonSnapshot() },
    ], new Map());
    expect(snap.root.tag).toBe("html");
    expect(snap.root.children).toHaveLength(1);
    const frameset = snap.root.children[0]!;
    expect(frameset.tag).toBe("frameset");
    expect(frameset.children).toHaveLength(2);
    expect(frameset.children[0]!.tag).toBe("frame");
    expect(frameset.children[1]!.tag).toBe("frame");
  });

  it("uses each frame's host-page rect as the frame element's box", () => {
    const snap = assembleFramesetSnapshot(PROBE, [
      { entry: PROBE.frames[0]!, snapshot: makeJsonSnapshot() },
      { entry: PROBE.frames[1]!, snapshot: makeJsonSnapshot() },
    ], new Map());
    const [menu, main] = snap.root.children[0]!.children;
    expect(menu!.rect).toEqual({ x: 0, y: 0, width: 200, height: 600 });
    expect(main!.rect).toEqual({ x: 200, y: 0, width: 600, height: 600 });
  });

  it("translates inner element rects from frame-local to host coordinates", () => {
    const snap = assembleFramesetSnapshot(PROBE, [
      { entry: PROBE.frames[1]!, snapshot: makeJsonSnapshot({ x: 0, y: 0, width: 600, height: 600 }) },
    ], new Map());
    const main = snap.root.children[0]!.children[0]!;
    // The synthetic frame's only child is the translated inner root
    // (the captured `<html>` of the loaded frame document). Inside
    // *that* root sits the captured `<div>` we synthesised at
    // (10, 5) within the frame's local coordinate space — it should
    // now sit at (210, 5) on the host page.
    const innerHtml = main.children[0]!;
    expect(innerHtml.rect.x).toBe(200);
    expect(innerHtml.rect.y).toBe(0);
    const innerDiv = innerHtml.children[0]!;
    expect(innerDiv.rect.x).toBe(210);
    expect(innerDiv.rect.y).toBe(5);
  });

  it("namespaces every node id under its frame so addresses stay unique", () => {
    const snap = assembleFramesetSnapshot(PROBE, [
      { entry: PROBE.frames[0]!, snapshot: makeJsonSnapshot() },
      { entry: PROBE.frames[1]!, snapshot: makeJsonSnapshot() },
    ], new Map());
    const ids = new Set<string>();
    function walk(el: { readonly id: string; readonly children: readonly { readonly id: string; readonly children: readonly unknown[] }[] }): void {
      expect(ids.has(el.id), `duplicate id: ${el.id}`).toBe(false);
      ids.add(el.id);
      for (const c of el.children) {
        walk(c as never);
      }
    }
    walk(snap.root);
    // Sanity: at least the root, frameset, two frames, two inner
    // roots, two inner divs are present.
    expect(ids.size).toBeGreaterThanOrEqual(7);
  });

  it("uses the frameset's host background as the snapshot's page background", () => {
    const snap = assembleFramesetSnapshot(PROBE, [], new Map());
    expect(snap.background).toBe("rgb(240, 240, 240)");
  });

  it("preserves the frameset id under the synth root so DFS paths are consistent", () => {
    const snap = assembleFramesetSnapshot(PROBE, [
      { entry: PROBE.frames[0]!, snapshot: makeJsonSnapshot() },
    ], new Map());
    expect(snap.root.id).toBe("0");
    expect(snap.root.children[0]!.id).toBe("0/0");
    expect(snap.root.children[0]!.children[0]!.id).toBe("0/0/0");
  });
});

describe("matchFrame", () => {
  function fakeFrame(url: string): FrameLike {
    return {
      url: () => url,
      parentFrame: () => null,
      evaluate: (() => Promise.resolve(undefined)) as never,
      waitForLoadState: () => Promise.resolve(),
    };
  }

  it("matches a Playwright frame by URL", () => {
    const f1 = fakeFrame("https://host.example/menu.html");
    const f2 = fakeFrame("https://host.example/main.html");
    const used = new Set<FrameLike>();
    const entry: FramesetEntry = {
      id: "0/0/0",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      src: "https://host.example/main.html",
      name: "",
      background: "",
    };
    const matched = matchFrame(entry, [f1, f2], used);
    expect(matched).toBe(f2);
    expect(used.has(f2)).toBe(true);
  });

  it("does not reuse a frame already consumed by a prior entry", () => {
    const f = fakeFrame("https://host.example/dup.html");
    const used = new Set<FrameLike>();
    const entry: FramesetEntry = {
      id: "0/0/0",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      src: "https://host.example/dup.html",
      name: "",
      background: "",
    };
    expect(matchFrame(entry, [f], used)).toBe(f);
    expect(matchFrame(entry, [f], used)).toBeUndefined();
  });

  it("returns undefined when no frame matches the URL", () => {
    const f = fakeFrame("https://host.example/x.html");
    const entry: FramesetEntry = {
      id: "0/0/0",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      src: "https://host.example/missing.html",
      name: "",
      background: "",
    };
    expect(matchFrame(entry, [f], new Set())).toBeUndefined();
  });
});
