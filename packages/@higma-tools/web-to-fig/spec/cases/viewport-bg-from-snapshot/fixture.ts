/**
 * @file `viewport-bg-from-snapshot` — when the in-page walker reports
 * a non-transparent `snapshot.background` (sourced from
 * `getComputedStyle(document.body).backgroundColor` per
 * `in-page.ts:1335-1336`), the IR must paint the root frame with that
 * background colour even when none of the captured tree's element-level
 * `background-color` carries it.
 *
 * Real captures keep both signals in sync — the body element has the
 * colour as its `computedStyle["background-color"]` AND the snapshot
 * stamp echoes it. But the snapshot stamp is the authoritative
 * canvas-paint source per the walker, so the IR's root fill should not
 * depend on a particular descendant's fill surviving propagation.
 *
 * This fixture exercises that contract: the captured tree is empty of
 * any `background-color`; only `snapshot.background` carries the colour.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const SNAPSHOT_BG = "rgb(238, 238, 238)";

/**
 * A neutral body-content child with no fills, so that the only way the
 * IR root can pick up a fill is from `snapshot.background`.
 */
export function emptyContentChild(): RawElement {
  return synthEl({
    id: "content",
    tag: "div",
    rect: { x: 256, y: 120, width: 768, height: 96 },
  });
}
