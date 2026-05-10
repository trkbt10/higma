/**
 * @file `custom-element-frame` — distilled from the YouTube masthead:
 * a custom element (`<ytd-masthead>`) with three child `<div>`s. The
 * normaliser must NOT special-case the tag name; any unknown tag
 * walks the same path as `<div>` and produces a FRAME IR with the
 * captured children.
 *
 * Real risk: a future regression that gates on a known tag whitelist
 * (e.g. "only emit FRAME for div/section/article") would silently
 * drop every Polymer-flavoured page.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const HOST_RECT: RawRect = { x: 0, y: 0, width: 1280, height: 56 };
export const CHILD_WIDTH = 200;
export const CHILD_HEIGHT = 56;
export const CHILD_COUNT = 3;

/**
 * Build a `<ytd-masthead>` custom-element host with N `<div>` children
 * laid out horizontally.
 */
export function customElementFrame(): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: x-coords for child rects
  let cursorX = 0;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    children.push(
      synthEl({
        id: `host/${i}`,
        tag: "div",
        rect: { x: cursorX, y: 0, width: CHILD_WIDTH, height: CHILD_HEIGHT },
      }),
    );
    cursorX += CHILD_WIDTH;
  }
  return synthEl({
    id: "host",
    tag: "ytd-masthead",
    rect: HOST_RECT,
    children,
  });
}
