/**
 * @file Hand-built RawViewportSnapshot mirroring the gross structure
 * of example.com:
 *
 *   body
 *     └── div (the centred 600x..-ish content card)
 *         ├── h1  "Example Domain"
 *         ├── p   "This domain is for use in illustrative examples..."
 *         └── p   "<a>More information...</a>"
 *
 * The fixture is deterministic and self-contained so the round-trip
 * spec can run without launching a browser. The geometry is taken
 * from a real Chromium rendering at viewport 1280x800 so the layout
 * inference exercises the same code paths a Playwright capture would.
 */
import type { RawViewportSnapshot, RawElement } from "../src/web-source/snapshot";

const NEUTRAL_COMPUTED: Readonly<Record<string, string>> = {
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "background-position": "0% 0%",
  "background-repeat": "repeat",
  "background-size": "auto auto",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-color": "rgb(0, 0, 0)",
  "border-top-style": "none",
  "border-radius": "0px",
  "border-top-left-radius": "0px",
  "border-top-right-radius": "0px",
  "border-bottom-right-radius": "0px",
  "border-bottom-left-radius": "0px",
  "box-shadow": "none",
  color: "rgb(0, 0, 0)",
  display: "block",
  filter: "none",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "font-family": "sans-serif",
  "font-size": "16px",
  "font-style": "normal",
  "font-weight": "400",
  gap: "0px",
  "row-gap": "0px",
  "column-gap": "0px",
  "justify-content": "normal",
  "letter-spacing": "normal",
  "line-height": "normal",
  "mix-blend-mode": "normal",
  opacity: "1",
  overflow: "visible",
  "overflow-x": "visible",
  "overflow-y": "visible",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  position: "static",
  "text-align": "left",
  "text-decoration-line": "none",
  "text-transform": "none",
  transform: "none",
  visibility: "visible",
  "align-items": "normal",
};

function withStyle(overrides: Record<string, string>): Readonly<Record<string, string>> {
  return { ...NEUTRAL_COMPUTED, ...overrides };
}

function el(input: {
  readonly id: string;
  readonly tag: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly contentRect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly computedStyle: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly children?: readonly RawElement[];
}): RawElement {
  const cr = input.contentRect ?? input.rect;
  return {
    id: input.id,
    tag: input.tag,
    rect: input.rect,
    contentRect: cr,
    visible: true,
    computedStyle: input.computedStyle,
    text: input.text,
    children: input.children ?? [],
  };
}

const h1 = el({
  id: "0/0/0",
  tag: "h1",
  rect: { x: 340, y: 252, width: 600, height: 38 },
  computedStyle: withStyle({
    "font-size": "32px",
    "font-weight": "700",
    "line-height": "37.5px",
    color: "rgb(34, 34, 34)",
  }),
  text: "Example Domain",
});

const p1 = el({
  id: "0/0/1",
  tag: "p",
  rect: { x: 340, y: 322, width: 600, height: 27 },
  computedStyle: withStyle({
    "font-size": "16px",
    "line-height": "27px",
    color: "rgb(34, 34, 34)",
  }),
  text: "This domain is for use in illustrative examples in documents.",
});

const p2 = el({
  id: "0/0/2",
  tag: "p",
  rect: { x: 340, y: 381, width: 600, height: 27 },
  computedStyle: withStyle({
    "font-size": "16px",
    "line-height": "27px",
    color: "rgb(34, 34, 34)",
  }),
  text: "More information...",
});

const card = el({
  id: "0/0",
  tag: "div",
  rect: { x: 308, y: 220, width: 664, height: 220 },
  contentRect: { x: 340, y: 252, width: 600, height: 156 },
  computedStyle: withStyle({
    "background-color": "rgb(255, 255, 255)",
    "border-top-width": "1px",
    "border-right-width": "1px",
    "border-bottom-width": "1px",
    "border-left-width": "1px",
    "border-top-color": "rgb(204, 204, 204)",
    "padding-top": "32px",
    "padding-right": "32px",
    "padding-bottom": "32px",
    "padding-left": "32px",
  }),
  children: [h1, p1, p2],
});

const body = el({
  id: "0",
  tag: "body",
  rect: { x: 0, y: 0, width: 1280, height: 800 },
  contentRect: { x: 0, y: 0, width: 1280, height: 800 },
  computedStyle: withStyle({
    "background-color": "rgb(240, 240, 242)",
  }),
  children: [card],
});

export const exampleComFixture: RawViewportSnapshot = {
  source: "https://example.com/",
  viewport: { x: 0, y: 0, width: 1280, height: 800 },
  devicePixelRatio: 1,
  background: "rgb(240, 240, 242)",
  root: body,
  assets: new Map(),
};
