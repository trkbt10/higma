/**
 * @file `z-index-stacking` — two siblings with overlapping rects, the
 * second carrying a higher `z-index`. CSS draws the higher z-index
 * on top regardless of DOM source order. The IR / Figma both use
 * source-order child arrays where later = on top, so a faithful
 * normaliser would reorder the IR children.
 *
 * Today nothing reads `z-index`, so the IR keeps DOM source order
 * and the rendered Figma frame paints them in the wrong order.
 * The case exposes the gap by asserting the IR's last child is the
 * one with the highest z-index.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

/** Two overlapping absolutely-positioned siblings authored HIGH-then-LOW in DOM order. */
export function overlappingSiblings(): RawElement {
  // DOM order is intentionally HIGH-then-LOW: source order would
  // paint LOW on top, but z-index 5 > z-index 1, so CSS paints HIGH
  // on top. A normaliser that ignores z-index would emit them in DOM
  // order with LOW last (= painted on top in Figma) — wrong.
  const high = synthEl({
    id: "parent/high",
    tag: "div",
    rect: { x: 50, y: 50, width: 100, height: 100 },
    styleOverrides: {
      position: "absolute",
      "z-index": "5",
      "background-color": "rgb(0, 0, 255)",
    },
  });
  const low = synthEl({
    id: "parent/low",
    tag: "div",
    rect: { x: 0, y: 0, width: 100, height: 100 },
    styleOverrides: {
      position: "absolute",
      "z-index": "1",
      "background-color": "rgb(255, 0, 0)",
    },
  });
  return synthEl({
    id: "parent",
    tag: "div",
    rect: { x: 0, y: 0, width: 200, height: 200 },
    styleOverrides: { position: "relative" },
    children: [high, low],
  });
}
