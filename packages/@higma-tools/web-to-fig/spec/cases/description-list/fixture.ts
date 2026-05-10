/**
 * @file `description-list` — `<dl><dt>term</dt><dd>desc</dd></dl>`.
 * Glossary pattern (e.g. MDN doc pages, technical specs).
 *
 * `<dt>` and `<dd>` are both `display: block` (UA default) and carry
 * leaf text. The `<dl>` wrapper is `display: block`. So:
 *   - `<dl>` is a FRAME with two children (the `<dt>` and the `<dd>`).
 *   - Each of `<dt>` and `<dd>` is a leaf-text paragraph host that
 *     collapses to a TEXT IR.
 *
 * Nothing fancy semantically, but the case proves the normaliser
 * doesn't special-case the `<dt>` / `<dd>` tag names — they're
 * handled exactly like any other block-level leaf-text element.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const ROOT_RECT: RawRect = { x: 0, y: 0, width: 400, height: 80 };
export const DT_RECT: RawRect = { x: 0, y: 0, width: 400, height: 24 };
export const DD_RECT: RawRect = { x: 40, y: 24, width: 360, height: 24 };
export const TERM = "Idempotent";
export const DESC = "Producing the same result when applied multiple times.";

const BLOCK_LEAF = {
  display: "block",
  color: "rgb(0, 0, 0)",
  "font-size": "16px",
} as const;

/** Build `<dl><dt>Idempotent</dt><dd>Producing …</dd></dl>`. */
export function descriptionList(): RawElement {
  const dt = synthEl({
    id: "dl/dt",
    tag: "dt",
    rect: DT_RECT,
    styleOverrides: { ...BLOCK_LEAF, "font-weight": "700" },
    text: TERM,
  });
  const dd = synthEl({
    id: "dl/dd",
    tag: "dd",
    rect: DD_RECT,
    styleOverrides: BLOCK_LEAF,
    text: DESC,
  });
  return synthEl({
    id: "dl",
    tag: "dl",
    rect: ROOT_RECT,
    styleOverrides: { display: "block" },
    children: [dt, dd],
  });
}
