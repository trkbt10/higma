/**
 * @file `fixed-masthead-flex-row` — distilled from the YouTube
 * masthead: a `position: fixed` parent at the viewport's top edge,
 * containing a flex-row of three children (logo + search + account
 * cluster). Two pipeline behaviours interact here:
 *
 *   1. `liftViewportLayer` lifts the fixed subtree out of the static
 *      tree into `viewportLayer`.
 *   2. The lifted subtree itself is normalised with explicit flex
 *      semantics (no inferer needed).
 *
 * The case asserts both halves: the static root has no children left,
 * and the viewport layer carries the masthead with its three children
 * intact in a row autoLayout.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const MASTHEAD_RECT: RawRect = { x: 0, y: 0, width: 1280, height: 56 };
export const LOGO_RECT: RawRect = { x: 24, y: 12, width: 100, height: 32 };
export const SEARCH_RECT: RawRect = { x: 200, y: 12, width: 600, height: 32 };
export const ACCOUNT_RECT: RawRect = { x: 1100, y: 12, width: 156, height: 32 };

/**
 * Build a `position: fixed` masthead with three flex-row children
 * (logo, search bar, account cluster).
 */
export function fixedMastheadFlexRow(): RawElement {
  const logo = synthEl({ id: "mast/logo", tag: "div", rect: LOGO_RECT });
  const search = synthEl({ id: "mast/search", tag: "div", rect: SEARCH_RECT });
  const account = synthEl({ id: "mast/account", tag: "div", rect: ACCOUNT_RECT });
  return synthEl({
    id: "mast",
    tag: "ytd-masthead",
    rect: MASTHEAD_RECT,
    contentRect: MASTHEAD_RECT,
    styleOverrides: {
      position: "fixed",
      display: "flex",
      "flex-direction": "row",
      "background-color": "rgb(255, 255, 255)",
    },
    children: [logo, search, account],
  });
}
