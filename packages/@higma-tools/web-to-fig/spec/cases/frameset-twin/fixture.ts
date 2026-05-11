/**
 * @file `frameset-twin` — synthetic two-frame `<frameset>` snapshot.
 *
 * Mirrors what `assembleFramesetSnapshot` produces from a
 * `<frameset cols="...">` page: a top-level `<html>` with a
 * `<frameset>` child holding two `<frame>` children. Each
 * `<frame>`'s rect comes from `getBoundingClientRect()` on the host
 * page; the inner `<html>` of each loaded sub-document sits at the
 * frame's host-page origin.
 *
 * The fixture is a pure data structure — no Playwright. It exercises
 * the normaliser's ability to ingest the assembled `RawElement` tree
 * and surface two side-by-side child frames.
 */
import type { RawElement, RawRect, RawViewportSnapshot } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

const VIEWPORT: RawRect = { x: 0, y: 0, width: 800, height: 600 };

const LEFT_FRAME_RECT: RawRect = { x: 0, y: 0, width: 200, height: 600 };
const RIGHT_FRAME_RECT: RawRect = { x: 200, y: 0, width: 600, height: 600 };

/** Inner document body for one frame: a single `<div>` carrying a fill. */
function innerDocumentBody(idPrefix: string, fill: string, rect: RawRect): RawElement {
  // The inner `<html>` mirrors what `captureSnapshot()` returns on a
  // sub-frame: a documentElement with body + content. The synthetic
  // path matches the inner-id namespacing used by
  // `assembleFramesetSnapshot`.
  return synthEl({
    id: `${idPrefix}/inner`,
    tag: "html",
    rect,
    contentRect: rect,
    children: [
      synthEl({
        id: `${idPrefix}/inner/0`,
        tag: "body",
        rect,
        contentRect: rect,
        styleOverrides: { "background-color": fill },
        children: [
          synthEl({
            id: `${idPrefix}/inner/0/0`,
            tag: "div",
            rect: { x: rect.x + 10, y: rect.y + 10, width: rect.width - 20, height: rect.height - 20 },
            contentRect: { x: rect.x + 10, y: rect.y + 10, width: rect.width - 20, height: rect.height - 20 },
          }),
        ],
      }),
    ],
  });
}

/** Build a `<frameset>` snapshot with a left menu pane and a right body pane. */
export function framesetTwin(): RawViewportSnapshot {
  const leftFrame = synthEl({
    id: "0/0/0",
    tag: "frame",
    rect: LEFT_FRAME_RECT,
    contentRect: LEFT_FRAME_RECT,
    children: [innerDocumentBody("0/0/0", "rgb(220, 220, 220)", LEFT_FRAME_RECT)],
  });
  const rightFrame = synthEl({
    id: "0/0/1",
    tag: "frame",
    rect: RIGHT_FRAME_RECT,
    contentRect: RIGHT_FRAME_RECT,
    children: [innerDocumentBody("0/0/1", "rgb(255, 250, 240)", RIGHT_FRAME_RECT)],
  });
  const frameset = synthEl({
    id: "0/0",
    tag: "frameset",
    rect: VIEWPORT,
    contentRect: VIEWPORT,
    children: [leftFrame, rightFrame],
  });
  const html = synthEl({
    id: "0",
    tag: "html",
    rect: VIEWPORT,
    contentRect: VIEWPORT,
    children: [frameset],
  });
  return {
    source: "https://example.test/frameset",
    viewport: VIEWPORT,
    devicePixelRatio: 1,
    background: "rgb(255, 255, 255)",
    root: html,
    assets: new Map(),
  };
}

export { LEFT_FRAME_RECT, RIGHT_FRAME_RECT, VIEWPORT };
