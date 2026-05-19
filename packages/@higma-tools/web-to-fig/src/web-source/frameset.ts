/**
 * @file HTML4 `<frameset>` capture path.
 *
 * The legacy `<frameset>` document model splits the viewport into a
 * grid of named regions, each loading a *separate* document via
 * `<frame src="...">`. Browsers still render this layout (Abe
 * Hiroshi's site is the canonical surviving example), but the DOM
 * boundary between the host document and each frame's document is
 * opaque — the in-page `captureSnapshot()` walking from
 * `document.documentElement` only sees `<frame>` element shells, not
 * their loaded content.
 *
 * Playwright surfaces every loaded sub-document as a `Frame` object
 * on the same `Page`. We harvest each `<frame>` element's box on the
 * host page (Chromium fills `getBoundingClientRect` correctly for
 * frames per the CSSOM frameset layout algorithm) and run the
 * regular `captureSnapshot()` *inside* each frame's evaluation
 * context. The per-frame snapshots are then translated into the
 * host's coordinate space and grafted under a synthetic root that
 * stands in for the `<frameset>` element itself.
 *
 * This is not a heuristic — it is the structural mirror of the W3C
 * frameset layout: each `<frame>` becomes a positioned child whose
 * geometry comes from the host page's frame element rect, and whose
 * inner DOM is the captured documentElement of the loaded sub-page.
 */
import type {
  RawAsset,
  RawElement,
  RawRect,
  RawViewportSnapshot,
} from "./snapshot";
import type { ElementJson, RawSnapshotJson } from "./in-page";
import { captureSnapshot } from "./in-page";
import type { FrameLike } from "./playwright-shared";

/** One `<frame>` element discovered on the host page. */
export type FramesetEntry = {
  /** Matches the path id assigned by `walk()` in in-page.ts (e.g. `"0/0/1"`). */
  readonly id: string;
  /** Page-relative bounding rect — CSS pixels, host-page coordinates. */
  readonly rect: RawRect;
  /** Resolved absolute URL of the frame's loaded document. */
  readonly src: string;
  /** `<frame name="...">` if authored, else the empty string. */
  readonly name: string;
  /** Captured background-color of the frame element on the host page. */
  readonly background: string;
};

/** Result of probing the host page for a frameset structure. */
export type FramesetProbe = {
  /**
   * `true` when the page document's structural root is a
   * `<frameset>`. The check is precise — `<iframe>`-only pages do
   * NOT trigger this path because they keep a `<body>`.
   */
  readonly isFrameset: boolean;
  /** Each authored `<frame>` element with its host-page geometry. */
  readonly frames: readonly FramesetEntry[];
  /** The frameset element's own background, used as the assembled snapshot's page background. */
  readonly framesetBackground: string;
  /** Viewport size on the host page. */
  readonly viewport: RawRect;
  /** Device pixel ratio of the host page. */
  readonly devicePixelRatio: number;
  /** Source URL of the host page (the frameset document itself). */
  readonly source: string;
};

/**
 * In-page probe. Returns the frameset structure or an `isFrameset:
 * false` marker. Lives here, not in in-page.ts, because the regular
 * `captureSnapshot()` is unaware of frames — this probe is invoked
 * separately on the main page only.
 */
export function probeFrameset(): FramesetProbe {
  const docEl = document.documentElement;
  // Find the frameset, if any. HTML4 forbids both `<body>` and
  // `<frameset>` simultaneously; presence of a `<frameset>` directly
  // under `<html>` is the structural signal.
  const framesetEl = docEl.querySelector(":scope > frameset");
  const viewport: RawRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  if (framesetEl === null) {
    return {
      isFrameset: false,
      frames: [],
      framesetBackground: "rgb(255, 255, 255)",
      viewport,
      devicePixelRatio: window.devicePixelRatio,
      source: window.location.href,
    };
  }
  // Walk the frameset subtree depth-first and collect every `<frame>`
  // descendant. Nested framesets (rows-then-cols compositions) are
  // legal and common — Abe Hiroshi's site for instance puts the
  // header in a top row and splits the bottom into menu/body cols.
  // Each `<frame>` carries its own `getBoundingClientRect`, so we
  // never need to compute the frameset grid ourselves.
  const frames: FramesetEntry[] = [];
  // Mirrors the path-id scheme used by `walk()` in in-page.ts so the
  // assembled snapshot keeps stable, addressable element ids. The
  // frameset element gets `id = "0/<frameset-index-under-html>"`
  // synthesised host-side; child frames get
  // `id = "<frameset-id>/<dfs-index>"`.
  function walkFrameset(node: Element, prefix: string): void {
    const children = node.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      const childId = `${prefix}/${i}`;
      const tag = child.tagName.toLowerCase();
      if (tag === "frame") {
        const rect = child.getBoundingClientRect();
        frames.push({
          id: childId,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          src: (child as HTMLFrameElement).src,
          name: (child as HTMLFrameElement).name,
          background: window.getComputedStyle(child).backgroundColor || "rgb(255, 255, 255)",
        });
      } else if (tag === "frameset") {
        walkFrameset(child, childId);
      }
    }
  }
  // Find the frameset's index under `<html>`. The synth root id has
  // to match the indexing scheme `walk()` uses host-side, so the
  // frameset becomes the captured root's only child.
  const htmlChildren = docEl.children;
  // eslint-disable-next-line no-restricted-syntax -- DOM index is intrinsically mutable
  let framesetIndex = -1;
  for (let i = 0; i < htmlChildren.length; i += 1) {
    if (htmlChildren[i] === framesetEl) {
      framesetIndex = i;
      break;
    }
  }
  if (framesetIndex < 0) {
    // Defensive: the querySelector matched a descendant we did not
    // see in the direct children walk. Treat as "not a frameset
    // document" rather than guessing.
    return {
      isFrameset: false,
      frames: [],
      framesetBackground: "rgb(255, 255, 255)",
      viewport,
      devicePixelRatio: window.devicePixelRatio,
      source: window.location.href,
    };
  }
  const framesetId = `0/${framesetIndex}`;
  walkFrameset(framesetEl, framesetId);
  return {
    isFrameset: true,
    frames,
    framesetBackground: window.getComputedStyle(framesetEl).backgroundColor || "rgb(255, 255, 255)",
    viewport,
    devicePixelRatio: window.devicePixelRatio,
    source: window.location.href,
  };
}

/**
 * Run the regular in-page snapshot inside a single sub-frame's
 * document context, then prefix every imageId so per-frame asset
 * registries don't collide when merged into the host snapshot.
 */
export async function captureFrameContent(
  frame: FrameLike,
  idPrefix: string,
): Promise<RawSnapshotJson> {
  // Sub-frames are attached to the same `Page`, so `waitForLoadState`
  // here only awaits the *frame's* own load state. The page-level
  // `waitForReady` already gated the parent's overall readiness.
  await frame.waitForLoadState("domcontentloaded");
  const json = await frame.evaluate(captureSnapshot);
  return prefixImageIds(json, idPrefix);
}

function prefixImageIds(json: RawSnapshotJson, prefix: string): RawSnapshotJson {
  const renamed = new Map<string, string>();
  for (const ref of json.imageRefs) {
    renamed.set(ref.id, `${prefix}:${ref.id}`);
  }
  return {
    ...json,
    root: rewriteElementImageIds(json.root, renamed),
    imageRefs: json.imageRefs.map((r) => ({ id: renamed.get(r.id) ?? r.id, url: r.url })),
  };
}

function rewriteElementImageIds(el: ElementJson, map: ReadonlyMap<string, string>): ElementJson {
  const renamedImageId = el.imageId !== undefined ? map.get(el.imageId) ?? el.imageId : undefined;
  const renamedImageIds = el.imageIds?.map((id) => map.get(id) ?? id);
  const renamedMaskId = el.maskImageId !== undefined ? map.get(el.maskImageId) ?? el.maskImageId : undefined;
  return {
    ...el,
    imageId: renamedImageId,
    imageIds: renamedImageIds,
    maskImageId: renamedMaskId,
    children: el.children.map((c) => rewriteElementImageIds(c, map)),
  };
}

/**
 * Assemble per-frame snapshots into a single `RawViewportSnapshot`
 * whose root represents the host frameset document. Each frame's
 * captured root is translated from frame-local coordinates (frame's
 * own `0,0`) into host-page coordinates so downstream normalisation
 * sees one coherent viewport.
 *
 * The synth tree is shaped so the IR can render it without
 * frameset-specific awareness:
 *
 *   - Outer root: `<html>` standing in for the host page, full viewport rect.
 *   - Single child: the `<frameset>` element, also full-viewport.
 *   - Frameset's children: one entry per `<frame>`, with `tag: "frame"`,
 *     positioned at the captured `<frame>` rect, containing the
 *     translated documentElement of the loaded sub-page.
 */
export function assembleFramesetSnapshot(
  probe: FramesetProbe,
  perFrame: ReadonlyArray<{ readonly entry: FramesetEntry; readonly snapshot: RawSnapshotJson }>,
  assets: ReadonlyMap<string, RawAsset>,
): RawViewportSnapshot {
  const framesetIndex = parseFramesetIndexFromAnyEntry(probe.frames);
  const synthRootId = "0";
  const framesetId = `0/${framesetIndex}`;
  // Translate each frame's captured DOM tree into host coordinates,
  // then nest under a synthetic `<frame>` element whose rect equals
  // the captured frame box on the host page. Wrapping in a
  // synthetic `<frame>` instead of attaching the inner documentElement
  // directly preserves the host-page background of the frame slot
  // (in case an authored CSS gives the frame a tinted background)
  // and keeps the id namespace stable.
  const frameChildren: RawElement[] = perFrame.map(({ entry, snapshot }) => {
    const translatedInner = translateElement(elementJsonToRaw(snapshot.root), entry.rect.x, entry.rect.y, entry.id);
    const inner: RawElement = {
      ...translatedInner,
      // The translated inner root is the inner document's `<html>`.
      // Re-root it under our synthetic frame id so descendant ids
      // remain unique across frames.
      id: `${entry.id}/inner`,
    };
    return makeFrameElement(entry, inner);
  });
  const framesetEl: RawElement = {
    id: framesetId,
    tag: "frameset",
    rect: probe.viewport,
    contentRect: probe.viewport,
    visible: true,
    computedStyle: {
      "background-color": probe.framesetBackground,
      "display": "block",
    },
    children: frameChildren,
  };
  const htmlEl: RawElement = {
    id: synthRootId,
    tag: "html",
    rect: probe.viewport,
    contentRect: probe.viewport,
    visible: true,
    computedStyle: {
      "background-color": probe.framesetBackground,
      "display": "block",
    },
    children: [framesetEl],
  };
  return {
    source: probe.source,
    viewport: probe.viewport,
    devicePixelRatio: probe.devicePixelRatio,
    background: probe.framesetBackground,
    root: htmlEl,
    assets,
  };
}

/**
 * Pull the `<frameset>`'s host-page index out of the first frame's
 * id (paths look like `0/<frameset-index>/<frame-index>`). Every
 * frame entry shares the same frameset prefix by construction, so
 * any one suffices.
 */
function parseFramesetIndexFromAnyEntry(frames: readonly FramesetEntry[]): number {
  if (frames.length === 0) {
    // No frames means the frameset is empty — still legal HTML4. Use
    // index 0 for the synth `<frameset>` placeholder.
    return 0;
  }
  const segments = frames[0]!.id.split("/");
  // segments = ["0", "<framesetIndex>", ...]
  const framesetIndex = Number.parseInt(segments[1] ?? "0", 10);
  if (!Number.isFinite(framesetIndex)) {
    throw new Error(`assembleFramesetSnapshot: frame id "${frames[0]!.id}" did not encode a frameset index`);
  }
  return framesetIndex;
}

function makeFrameElement(entry: FramesetEntry, inner: RawElement): RawElement {
  return {
    id: entry.id,
    tag: "frame",
    rect: entry.rect,
    contentRect: entry.rect,
    visible: true,
    computedStyle: {
      "background-color": entry.background,
      "display": "block",
    },
    children: [inner],
  };
}

/**
 * Walk an element tree and translate every `rect` / `contentRect` by
 * `(dx, dy)`. Used to lift a frame-local capture (whose root rect
 * starts at `0,0` inside the frame's viewport) into the host page's
 * coordinate system.
 *
 * Also rewrites `id` paths under the synthetic frame parent so the
 * assembled tree has a unique address for every node — necessary
 * because two captured frames would otherwise share `id = "0"` for
 * their respective `<html>` elements.
 */
function translateElement(el: RawElement, dx: number, dy: number, idPrefix: string): RawElement {
  return {
    ...el,
    id: `${idPrefix}/${el.id}`,
    rect: translateRect(el.rect, dx, dy),
    contentRect: translateRect(el.contentRect, dx, dy),
    children: el.children.map((c) => translateElement(c, dx, dy, idPrefix)),
  };
}

function translateRect(rect: RawRect, dx: number, dy: number): RawRect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/**
 * Convert the in-page JSON shape into the host-side `RawElement`
 * shape. Mirrors `elementJsonToRaw` in capture.ts but lives here so
 * the frameset assembly module is self-contained — capture.ts'
 * routine is `function`-private. Both routines must stay in lock-step;
 * adding a field requires updating both.
 */
function elementJsonToRaw(json: ElementJson): RawElement {
  return {
    id: json.id,
    tag: json.tag,
    rect: json.rect,
    contentRect: json.contentRect,
    visible: json.visible,
    computedStyle: json.computedStyle,
    imageId: json.imageId,
    imageIds: json.imageIds,
    imageNaturalWidth: json.imageNaturalWidth,
    imageNaturalHeight: json.imageNaturalHeight,
    maskImageId: json.maskImageId,
    maskSvgContent: json.maskSvgContent,
    maskNaturalWidth: json.maskNaturalWidth,
    maskNaturalHeight: json.maskNaturalHeight,
    svgContent: json.svgContent,
    text: json.text,
    textFragments: json.textFragments,
    textLineRects: json.textLineRects,
    textLineBaselineYs: json.textLineBaselineYs,
    textCharacterFontRuns: json.textCharacterFontRuns,
    pseudo: json.pseudo,
    children: json.children.map(elementJsonToRaw),
  };
}

/**
 * Find the Playwright `Frame` whose `url()` matches a captured
 * `<frame>` `src`. Both URLs are absolute so a strict equality is
 * sufficient — Playwright resolves relative `src` attributes the
 * same way the browser does. When the same `src` appears in
 * multiple `<frame>` elements (legal but unusual), we consume each
 * match once via `usedFrames` so the assembly stays one-to-one.
 */
export function matchFrame(
  entry: FramesetEntry,
  frames: readonly FrameLike[],
  usedFrames: Set<FrameLike>,
): FrameLike | undefined {
  for (const f of frames) {
    if (usedFrames.has(f)) {
      continue;
    }
    if (f.url() === entry.src) {
      usedFrames.add(f);
      return f;
    }
  }
  return undefined;
}
