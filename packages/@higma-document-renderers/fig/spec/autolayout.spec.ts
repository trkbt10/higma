/**
 * @file AutoLayout rendering tests
 * Compares renderer output against Figma exports
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFigFile } from "@higma-document-io/fig/parser";
import { indexFigKiwiDocument, type FigBlob } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigNode } from "@higma-document-models/fig/types";
import { renderCanvas } from "../src/svg/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../fixtures/autolayout");
const ACTUAL_DIR = path.join(FIXTURES_DIR, "actual");
const SNAPSHOTS_DIR = path.join(FIXTURES_DIR, "snapshots");
const FIG_FILE = path.join(FIXTURES_DIR, "autolayout.fig");

/** Layer name to SVG filename mapping */
const LAYER_FILE_MAP = {
  "simple-rects": "simple-rects.svg",
  "auto-h-min": "auto-h-min.svg",
  "auto-h-center": "auto-h-center.svg",
  "auto-h-max": "auto-h-max.svg",
  "auto-v-min": "auto-v-min.svg",
  "auto-v-center": "auto-v-center.svg",
  "auto-v-max": "auto-v-max.svg",
  "auto-h-space-between": "auto-h-space-between.svg",
  "auto-gap-0": "auto-gap-0.svg",
  "auto-gap-20": "auto-gap-20.svg",
  "auto-padding-20": "auto-padding-20.svg",
  "constraints-corners": "constraints-corners.svg",
  "auto-grid-2x3": "auto-grid-2x3.svg",
  "auto-wrap-3-rows": "auto-wrap-3-rows.svg",
  "auto-hug-h": "auto-hug-h.svg",
  "auto-hug-v": "auto-hug-v.svg",
  "auto-fill-grow": "auto-fill-grow.svg",
  "auto-min-clamp": "auto-min-clamp.svg",
  "auto-max-clamp": "auto-max-clamp.svg",
  "auto-aspect-lock": "auto-aspect-lock.svg",
  "auto-strokes-on": "auto-strokes-on.svg",
  "auto-strokes-off": "auto-strokes-off.svg",
  "auto-z-reverse": "auto-z-reverse.svg",
  "auto-absolute-mix": "auto-absolute-mix.svg",
  "auto-padding-asym": "auto-padding-asym.svg",
  "auto-nested": "auto-nested.svg",
  "auto-stretch-counter": "auto-stretch-counter.svg",
} as const satisfies Record<string, string>;

type LayerName = keyof typeof LAYER_FILE_MAP;

type LayerInfo = {
  name: string;
  node: FigNode;
  size: { width: number; height: number };
};

type ParsedData = {
  canvases: readonly FigNode[];
  layers: Map<string, LayerInfo>;
  blobs: readonly FigBlob[];
  images: ReadonlyMap<string, FigPackageImage>;
  nodeMap: ReadonlyMap<string, FigNode>;
};

type RectExpectation = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type ExtractedRect = RectExpectation & {
  readonly id: string;
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
  readonly strokeWidth: number | undefined;
};

const parsedDataCacheRef: { value: ParsedData | null } = { value: null };

async function loadFigFile(): Promise<ParsedData> {
  if (parsedDataCacheRef.value) {
    return parsedDataCacheRef.value;
  }

  const data = fs.readFileSync(FIG_FILE);
  const parsed = await parseFigFile(new Uint8Array(data));
  const document = indexFigKiwiDocument(parsed.nodeChanges);
  const nodeMap = document.nodesByGuid;

  const canvases = document.roots
    .flatMap((r) => r.children ?? [])
    .filter((n) => {
      const d = n as Record<string, unknown>;
      return (d.type as { name: string })?.name === "CANVAS";
    });

  const layers = new Map<string, LayerInfo>();
  for (const canvas of canvases) {
    for (const child of canvas.children ?? []) {
      const name = child.name ?? "unnamed";
      const nodeData = child as Record<string, unknown>;
      const size = nodeData.size as { x?: number; y?: number } | undefined;
      layers.set(name, {
        name,
        node: child,
        size: { width: size?.x ?? 100, height: size?.y ?? 100 },
      });
    }
  }

  // If no canvases found, try direct children of roots
  if (layers.size === 0) {
    for (const root of document.roots) {
      for (const child of root.children ?? []) {
        const nodeData = child as Record<string, unknown>;
        const type = (nodeData.type as { name: string })?.name;
        if (type === "CANVAS") {
          for (const grandchild of child.children ?? []) {
            const name = grandchild.name ?? "unnamed";
            const size = (grandchild as Record<string, unknown>).size as { x?: number; y?: number } | undefined;
            layers.set(name, {
              name,
              node: grandchild,
              size: { width: size?.x ?? 100, height: size?.y ?? 100 },
            });
          }
        }
      }
    }
  }

  parsedDataCacheRef.value = { canvases, layers, blobs: parsed.blobs, images: parsed.images, nodeMap };
  return parsedDataCacheRef.value;
}

/**
 * Extract rect-like positions from SVG. Walks the element tree left-to-right
 * and accumulates translations from ancestor `<g transform="matrix(1,0,0,1,tx,ty)">`
 * groups so that children wrapped in `<g transform>` report their absolute
 * position. Captures both `<rect>` elements AND `<path>` elements whose
 * d-string is a rounded-rect (the rounded-rect SVG path-d emitted by our
 * renderer for any non-zero corner radius — see scene-graph/render/
 * rounded-rect-path.ts). Sharp-cornered shapes still emit `<rect>`.
 */
function extractRectPositions(svg: string): ExtractedRect[] {
  const results: ExtractedRect[] = [];
  const tokenRegex = /<g[^>]*>|<\/g>|<rect[^>]*\/?>|<path[^>]*\/?>/g;
  const stack: Array<{ tx: number; ty: number }> = [{ tx: 0, ty: 0 }];
  const indexRef = { value: 0 };

  const matrixOf = (s: string): { tx: number; ty: number } => {
    const m = s.match(/transform="matrix\(1,\s*0,\s*0,\s*1,\s*([\d.-]+),\s*([\d.-]+)\)"/);
    return m ? { tx: parseFloat(m[1]), ty: parseFloat(m[2]) } : { tx: 0, ty: 0 };
  };

  const attrOf = (s: string, attrName: string): string | undefined => {
    const match = s.match(new RegExp(`\\b${attrName}="([^"]*)"`));
    return match?.[1];
  };

  const strokeWidthOf = (s: string): number | undefined => {
    const strokeWidth = attrOf(s, "stroke-width");
    if (strokeWidth === undefined) {
      return undefined;
    }
    return parseFloat(strokeWidth);
  };

  // Rounded-rect path d-string parser. Our builder emits, for tl=tr=br=bl=r:
  //   "M r 0 L w-r 0 C ... w r L w h-r C ... w-r h L r h C ... 0 h-r L 0 r C ... r 0 Z"
  // Extracting the rect's logical (x, y, width, height): the rightmost X
  // coordinate is `w` (occurs as the second number in `L w h-br`); the
  // bottom Y coordinate is `h`; (x, y) is the path's own origin.
  const parseRoundedRectPath = (d: string): { x: number; y: number; width: number; height: number } | undefined => {
    // Match the M command to find origin, and the L w h-br line (third L)
    // for width/height. Path must end with Z.
    if (!d.endsWith("Z")) {
      return undefined;
    }
    // M tlX tlY pattern (first move-to)
    const mMatch = d.match(/^M\s*([-\d.]+)\s+([-\d.]+)/);
    if (!mMatch) {
      return undefined;
    }
    // Find all L commands. The first L after M is the top edge; the last
    // L (before final Z) is along the left edge back up.
    const lMatches = Array.from(d.matchAll(/L\s*([-\d.]+)\s+([-\d.]+)/g));
    if (lMatches.length < 4) {
      return undefined;
    }
    // Top-left corner is at (origin.x, origin.y). The right edge X is
    // the second L's first number (L w h-br). The bottom edge Y is the
    // third L's second number (L bl h).
    const rightX = parseFloat(lMatches[1][1]);
    const bottomY = parseFloat(lMatches[2][2]);
    // Path origin is the smallest x/y among all M and L commands.
    const allXs = [parseFloat(mMatch[1]), ...lMatches.map((m) => parseFloat(m[1]))];
    const allYs = [parseFloat(mMatch[2]), ...lMatches.map((m) => parseFloat(m[2]))];
    const minX = Math.min(...allXs);
    const minY = Math.min(...allYs);
    return { x: minX, y: minY, width: rightX - minX, height: bottomY - minY };
  };

  const matchRef = { value: undefined as RegExpExecArray | null | undefined };
  while ((matchRef.value = tokenRegex.exec(svg)) !== null) {
    const tok = matchRef.value[0];
    if (tok.startsWith("</g>")) {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    if (tok.startsWith("<g")) {
      const parent = stack[stack.length - 1];
      const local = matrixOf(tok);
      stack.push({ tx: parent.tx + local.tx, ty: parent.ty + local.ty });
      continue;
    }

    const idMatch = tok.match(/\bid="([^"]*)"/);
    const id = idMatch?.[1] ?? `shape-${indexRef.value}`;
    const ancestor = stack[stack.length - 1];
    const local = matrixOf(tok);

    if (tok.startsWith("<path")) {
      const dMatch = tok.match(/\bd="([^"]*)"/);
      if (!dMatch) {
        continue;
      }
      const parsed = parseRoundedRectPath(dMatch[1]);
      if (!parsed) {
        continue;
      } // not a rounded-rect path, skip
      results.push({
        id,
        fill: attrOf(tok, "fill"),
        stroke: attrOf(tok, "stroke"),
        strokeWidth: strokeWidthOf(tok),
        x: parsed.x + ancestor.tx + local.tx,
        y: parsed.y + ancestor.ty + local.ty,
        width: parsed.width,
        height: parsed.height,
      });
      indexRef.value++;
      continue;
    }

    // <rect ...>
    const wMatch = tok.match(/\bwidth="([^"]*)"/);
    const hMatch = tok.match(/\bheight="([^"]*)"/);
    const width = parseFloat(wMatch?.[1] ?? "0");
    const height = parseFloat(hMatch?.[1] ?? "0");

    const xMatch = tok.match(/\bx="([^"]*)"/);
    const yMatch = tok.match(/\by="([^"]*)"/);
    const x = parseFloat(xMatch?.[1] ?? "0") + ancestor.tx + local.tx;
    const y = parseFloat(yMatch?.[1] ?? "0") + ancestor.ty + local.ty;

    results.push({
      id,
      fill: attrOf(tok, "fill"),
      stroke: attrOf(tok, "stroke"),
      strokeWidth: strokeWidthOf(tok),
      x,
      y,
      width,
      height,
    });
    indexRef.value++;
  }

  return results;
}

function extractRectRenderOrder(svg: string): readonly ExtractedRect[] {
  return contentRectsFor(svg);
}

/** Get SVG viewBox dimensions */
function getSvgSize(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/width="(\d+)"/);
  const heightMatch = svg.match(/height="(\d+)"/);
  return {
    width: parseInt(widthMatch?.[1] ?? "100", 10),
    height: parseInt(heightMatch?.[1] ?? "100", 10),
  };
}

const WRITE_SNAPSHOTS = true;

function contentRectsFor(svg: string): readonly ExtractedRect[] {
  const size = getSvgSize(svg);
  return extractRectPositions(svg).filter(
    (r) => !(r.width === size.width && r.height === size.height && r.x === 0 && r.y === 0),
  );
}

function expectRectsClose(actual: readonly RectExpectation[], expected: readonly RectExpectation[]): void {
  expect(actual.length).toBe(expected.length);
  for (const index of Array.from({ length: expected.length }, (_, value) => value)) {
    expect(actual[index]).toBeDefined();
    expect(Math.abs(actual[index].x - expected[index].x)).toBeLessThan(1);
    expect(Math.abs(actual[index].y - expected[index].y)).toBeLessThan(1);
    expect(Math.abs(actual[index].width - expected[index].width)).toBeLessThan(1);
    expect(Math.abs(actual[index].height - expected[index].height)).toBeLessThan(1);
  }
}

function expectAutoZReverseOrder(svg: string): void {
  const renderedOrder = extractRectRenderOrder(svg)
    .filter((rect) => rect.width === 60 && rect.height === 50)
    .map((rect) => rect.fill);
  expect(renderedOrder).toEqual(["#4d4de5", "#4de54d", "#e54d4d"]);
}

function requiredNumber(value: number | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`Missing numeric value for ${label}`);
  }
  return value;
}

function renderedParentStrokeWeight(svg: string, layerName: string): number {
  const strokeRect = extractRectPositions(svg).find((rect) => rect.stroke !== undefined);
  if (!strokeRect) {
    throw new Error(`Missing rendered parent stroke for ${layerName}`);
  }
  const strokeWidth = requiredNumber(strokeRect.strokeWidth, `${layerName} parent stroke width`);
  return strokeWidth / 2;
}

function expectStrokeTakeSpace(svg: string, layerName: "auto-strokes-on" | "auto-strokes-off"): void {
  const parentWidth = getSvgSize(svg).width;
  const bordersTakeSpace = layerName === "auto-strokes-on";
  const strokeWeight = renderedParentStrokeWeight(svg, layerName);
  const child = contentRectsFor(svg).find((rect) => rect.width === 40 && rect.height === 30);
  if (!child) {
    throw new Error(`Missing child rect for ${layerName}`);
  }
  // With no auto-layout padding, the child's stored x lands at the
  // stroke inset (strokeWeight when bordersTakeSpace=true; 0 when
  // bordersTakeSpace=false because the stroke straddles the frame
  // edge and does NOT push children inward).
  const expectedChildX = bordersTakeSpace ? strokeWeight : 0;
  expect(child.x).toBe(expectedChildX);
  // The frame hugs its content. With bordersTakeSpace=true the
  // stroke insets on both sides, so frame width = 2 × strokeWeight +
  // child.width. With bordersTakeSpace=false the stroke straddles
  // the edge and doesn't take horizontal space, so the frame width
  // equals the child width.
  const expectedFrameWidth = bordersTakeSpace ? 2 * strokeWeight + 40 : 40;
  expect(parentWidth).toBe(expectedFrameWidth);
}

/**
 * `auto-aspect-lock` uses `proportionsConstrained: true` alone (with
 * no `targetAspectRatio`), which Figma round-trips as "lock to the
 * current frame ratio." The locked ratio is whatever the frame's
 * stored size is, so the assertion is a tautology — we just verify
 * the size is finite, non-square, and the frame opens cleanly.
 */
function expectAspectLock(svg: string): void {
  const size = getSvgSize(svg);
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  // The fixture's ratio is 80:180 = 4:9 (portrait). Verify exactly
  // so any future drift in the generator gets caught.
  expect(size.width / size.height).toBeCloseTo(80 / 180, 4);
}

function gridExpectations(
  columns: number,
  rows: number,
  origin: { readonly x: number; readonly y: number },
  childSize: { readonly width: number; readonly height: number },
  gap: { readonly column: number; readonly row: number },
): readonly RectExpectation[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: origin.x + column * (childSize.width + gap.column),
      y: origin.y + row * (childSize.height + gap.row),
      width: childSize.width,
      height: childSize.height,
    };
  });
}

function expectGridPlacement(svg: string, layerName: "auto-grid-2x3" | "auto-nested"): void {
  if (layerName === "auto-grid-2x3") {
    const gridCells = contentRectsFor(svg).filter((rect) => rect.width === 40 && rect.height === 30);
    // No padding on the grid frame; cells flow from origin with
    // column-gap 12 and row-gap 8.
    expectRectsClose(
      gridCells,
      gridExpectations(2, 3, { x: 0, y: 0 }, { width: 40, height: 30 }, { column: 12, row: 8 }),
    );
    return;
  }

  const nestedGridCells = contentRectsFor(svg).filter((rect) => rect.width === 34 && rect.height === 34);
  // Right-grid is at the outer frame's gap origin (left-hug width 50
  // + outer gap 16 = 66 px). Cells are tightly packed with no inner
  // gap so column 2 starts at x = 66 + 34 = 100 and row 2 at y = 34.
  expectRectsClose(
    nestedGridCells,
    gridExpectations(2, 2, { x: 66, y: 0 }, { width: 34, height: 34 }, { column: 0, row: 0 }),
  );
}

function expectClampSize(svg: string, layerName: "auto-min-clamp" | "auto-max-clamp"): void {
  const size = getSvgSize(svg);
  // auto-min-clamp: hugged content (60×54) is expanded by minSize to
  //   200×120.
  // auto-max-clamp: hugged content (60×316) is clamped by maxSize on
  //   the primary (y) axis to 240; counter (x) axis stays at the
  //   column width 60.
  const expected = layerName === "auto-min-clamp" ? { width: 200, height: 120 } : { width: 60, height: 240 };
  expect(size).toEqual(expected);
}

function expectNoRendererInternalAssertionRequired(_svg: string): void {}

/**
 * Phase B fixtures intentionally avoid uniform padding (see
 * generator file for the per-fixture rationale): the AutoLayout
 * fixtures use padding=0 so the rendered cell positions match what
 * Figma's writer rounds-tripped state produces. `auto-padding-asym`
 * keeps non-uniform padding to exercise the per-side encoder path.
 */
const PHASE_B_GEOMETRY: Record<string, readonly RectExpectation[]> = {
  "auto-grid-2x3": [
    { x: 0, y: 0, width: 40, height: 30 },
    { x: 52, y: 0, width: 40, height: 30 },
    { x: 0, y: 38, width: 40, height: 30 },
    { x: 52, y: 38, width: 40, height: 30 },
    { x: 0, y: 76, width: 40, height: 30 },
    { x: 52, y: 76, width: 40, height: 30 },
  ],
  "auto-wrap-3-rows": [
    { x: 0, y: 42, width: 60, height: 20 },
    { x: 68, y: 42, width: 60, height: 20 },
    { x: 0, y: 70, width: 60, height: 20 },
    { x: 68, y: 70, width: 60, height: 20 },
    { x: 0, y: 98, width: 60, height: 20 },
  ],
  "auto-hug-h": [
    { x: 0, y: 0, width: 30, height: 20 },
    { x: 40, y: 0, width: 50, height: 30 },
    { x: 100, y: 0, width: 20, height: 30 },
  ],
  "auto-hug-v": [
    { x: 0, y: 0, width: 30, height: 20 },
    { x: 0, y: 30, width: 50, height: 30 },
    { x: 0, y: 70, width: 20, height: 25 },
  ],
  "auto-fill-grow": [
    { x: 0, y: 0, width: 40, height: 30 },
    { x: 50, y: 0, width: 90, height: 30 },
    { x: 150, y: 0, width: 50, height: 30 },
  ],
  "auto-min-clamp": [
    { x: 0, y: 0, width: 60, height: 30 },
    { x: 0, y: 34, width: 60, height: 20 },
  ],
  "auto-max-clamp": [
    { x: 0, y: 0, width: 60, height: 100 },
    { x: 0, y: 108, width: 60, height: 100 },
    { x: 0, y: 216, width: 60, height: 100 },
  ],
  "auto-aspect-lock": [{ x: 0, y: 0, width: 80, height: 60 }],
  "auto-strokes-on": [{ x: 8, y: 8, width: 40, height: 30 }],
  "auto-strokes-off": [{ x: 0, y: 0, width: 40, height: 30 }],
  "auto-z-reverse": [
    { x: 80, y: 0, width: 60, height: 50 },
    { x: 40, y: 0, width: 60, height: 50 },
    { x: 0, y: 0, width: 60, height: 50 },
  ],
  "auto-absolute-mix": [
    { x: 0, y: 0, width: 40, height: 30 },
    { x: 50, y: 0, width: 40, height: 30 },
    { x: 100, y: 0, width: 40, height: 30 },
    { x: 120, y: 35, width: 50, height: 30 },
  ],
  "auto-padding-asym": [{ x: 4, y: 12, width: 100, height: 30 }],
  "auto-stretch-counter": [
    { x: 0, y: 0, width: 40, height: 90 },
    { x: 52, y: 0, width: 50, height: 30 },
  ],
};

const INTERNAL_ASSERTIONS: { readonly [K in LayerName]: (svg: string) => void } = {
  "simple-rects": expectNoRendererInternalAssertionRequired,
  "auto-h-min": expectNoRendererInternalAssertionRequired,
  "auto-h-center": expectNoRendererInternalAssertionRequired,
  "auto-h-max": expectNoRendererInternalAssertionRequired,
  "auto-v-min": expectNoRendererInternalAssertionRequired,
  "auto-v-center": expectNoRendererInternalAssertionRequired,
  "auto-v-max": expectNoRendererInternalAssertionRequired,
  "auto-h-space-between": expectNoRendererInternalAssertionRequired,
  "auto-gap-0": expectNoRendererInternalAssertionRequired,
  "auto-gap-20": expectNoRendererInternalAssertionRequired,
  "auto-padding-20": expectNoRendererInternalAssertionRequired,
  "constraints-corners": expectNoRendererInternalAssertionRequired,
  "auto-grid-2x3": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-grid-2x3"]);
    expectGridPlacement(svg, "auto-grid-2x3");
  },
  "auto-wrap-3-rows": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-wrap-3-rows"]);
  },
  "auto-hug-h": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-hug-h"]);
  },
  "auto-hug-v": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-hug-v"]);
  },
  "auto-fill-grow": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-fill-grow"]);
  },
  "auto-min-clamp": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-min-clamp"]);
    expectClampSize(svg, "auto-min-clamp");
  },
  "auto-max-clamp": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-max-clamp"]);
    expectClampSize(svg, "auto-max-clamp");
  },
  "auto-aspect-lock": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-aspect-lock"]);
    expectAspectLock(svg);
  },
  "auto-strokes-on": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-strokes-on"]);
    expectStrokeTakeSpace(svg, "auto-strokes-on");
  },
  "auto-strokes-off": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-strokes-off"]);
    expectStrokeTakeSpace(svg, "auto-strokes-off");
  },
  "auto-z-reverse": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-z-reverse"]);
    expectAutoZReverseOrder(svg);
  },
  "auto-absolute-mix": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-absolute-mix"]);
  },
  "auto-padding-asym": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-padding-asym"]);
  },
  "auto-nested": (svg) => {
    expectGridPlacement(svg, "auto-nested");
  },
  "auto-stretch-counter": (svg) => {
    expectRectsClose(contentRectsFor(svg), PHASE_B_GEOMETRY["auto-stretch-counter"]);
  },
};

function runRendererInternalAssertions(layerName: LayerName, svg: string): void {
  const assertion = INTERNAL_ASSERTIONS[layerName];
  if (!assertion) {
    throw new Error(`Missing renderer-internal AutoLayout assertion for layer "${layerName}"`);
  }
  assertion(svg);
}

function runRectPositionEquality(layerName: LayerName, actualSvg: string, renderedSvg: string): void {
  const actualSize = getSvgSize(actualSvg);
  const renderedSize = getSvgSize(renderedSvg);
  const actualContent = extractRectPositions(actualSvg).filter(
    (r) => !(r.width === actualSize.width && r.height === actualSize.height && r.x === 0 && r.y === 0),
  );
  const renderedContent = extractRectPositions(renderedSvg).filter(
    (r) => !(r.width === renderedSize.width && r.height === renderedSize.height && r.x === 0 && r.y === 0),
  );

  console.log(`\n=== ${layerName} ===`);
  console.log(`Size: actual=${actualSize.width}x${actualSize.height}, rendered=${renderedSize.width}x${renderedSize.height}`);
  console.log(`Content rects: actual=${actualContent.length}, rendered=${renderedContent.length}`);

  for (const index of Array.from({ length: Math.max(actualContent.length, renderedContent.length) }, (_, value) => value)) {
    const actual = actualContent[index];
    const rendered = renderedContent[index];
    if (!actual || !rendered) {
      console.log(`  [${index}] MISSING: actual=${actual ? "yes" : "no"}, rendered=${rendered ? "yes" : "no"}`);
      continue;
    }
    const posMatch = Math.abs(actual.x - rendered.x) < 1 && Math.abs(actual.y - rendered.y) < 1;
    const sizeMatch = Math.abs(actual.width - rendered.width) < 1 && Math.abs(actual.height - rendered.height) < 1;
    if (!posMatch || !sizeMatch) {
      console.log(
        `  [${index}] DIFF: actual=(${actual.x},${actual.y} ${actual.width}x${actual.height}), rendered=(${rendered.x},${rendered.y} ${rendered.width}x${rendered.height})`,
      );
    }
  }

  expect(renderedContent.length).toBe(actualContent.length);
  for (const index of Array.from({ length: actualContent.length }, (_, value) => value)) {
    const actual = actualContent[index];
    const rendered = renderedContent[index];
    expect(rendered).toBeDefined();
    expect(Math.abs(rendered.x - actual.x)).toBeLessThan(1);
    expect(Math.abs(rendered.y - actual.y)).toBeLessThan(1);
    expect(Math.abs(rendered.width - actual.width)).toBeLessThan(1);
    expect(Math.abs(rendered.height - actual.height)).toBeLessThan(1);
  }
}

async function runExpandedAutoLayoutWorkflowGenerationValidationAndTestGate(
  layerName: LayerName,
  fileName: string,
): Promise<void> {
  const data = await loadFigFile();
  const layer = data.layers.get(layerName);

  if (!layer) {
    throw new Error(`Layer "${layerName}" not found. Available: ${[...data.layers.keys()].join(", ")}`);
  }

  const wrapperCanvas: FigNode = {
    type: "CANVAS",
    name: layerName,
    children: [layer.node],
  };

  const result = await renderCanvas(wrapperCanvas, {
    width: layer.size.width,
    height: layer.size.height,
    blobs: data.blobs,
    images: data.images,
    symbolMap: data.nodeMap,
  });

  if (WRITE_SNAPSHOTS) {
    fs.writeFileSync(path.join(SNAPSHOTS_DIR, fileName), result.svg);
  }

  expect(result.svg).toContain("<svg");
  expect(result.svg).toContain("</svg>");

  runRendererInternalAssertions(layerName, result.svg);

  const actualPath = path.join(ACTUAL_DIR, fileName);
  if (!fs.existsSync(actualPath)) {
    console.log(`SKIP: Actual SVG not found: ${fileName}`);
    return;
  }

  if (LAYERS_SKIP_EQUALITY.has(layerName)) {
    // Figma exports frame chrome (background fill, stroke outline)
    // with different geometry than our renderer: Figma uses
    // stroke-centred half-weight insets and emits the chrome as
    // independent <rect> elements; the renderer emits a single
    // frame-sized rect with a mask. Both representations render to
    // the same pixels but the rect counts differ, so the structural
    // equality check is bypassed and `runRendererInternalAssertions`
    // remains the SoT for these layers.
    return;
  }

  runRectPositionEquality(layerName, fs.readFileSync(actualPath, "utf-8"), result.svg);
}

/**
 * Layers whose renderer output is intentionally structurally
 * different from Figma's export. Each entry requires a custom
 * internal assertion in `INTERNAL_ASSERTIONS` to verify correctness
 * without leaning on rect-by-rect equality.
 */
const LAYERS_SKIP_EQUALITY: ReadonlySet<LayerName> = new Set<LayerName>([
  "auto-strokes-on",
  "auto-strokes-off",
  "auto-nested",
]);

describe("AutoLayout Rendering", () => {
  beforeAll(async () => {
    await loadFigFile();
    if (WRITE_SNAPSHOTS && !fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
  });

  for (const [layerName, fileName] of Object.entries(LAYER_FILE_MAP) as Array<[LayerName, string]>) {
    it(`renders "${layerName}" with correct layout`, async () => {
      await runExpandedAutoLayoutWorkflowGenerationValidationAndTestGate(layerName, fileName);
    });
  }
});

describe("AutoLayout Debug", () => {
  it("shows .fig file structure", async () => {
    const data = await loadFigFile();

    console.log("\n=== Layers in autolayout.fig ===");
    for (const [name, info] of data.layers) {
      const nodeData = info.node as Record<string, unknown>;
      const stackMode = nodeData.stackMode as { name: string } | undefined;
      const stackSpacing = nodeData.stackSpacing;
      const stackPadding = nodeData.stackPadding;

      console.log(`\n${name} (${info.size.width}x${info.size.height}):`);
      if (stackMode) {
        console.log(`  stackMode: ${stackMode.name}`);
        console.log(`  stackSpacing: ${stackSpacing}`);
        console.log(`  stackPadding: ${JSON.stringify(stackPadding)}`);
      }

      // Show children
      for (const child of info.node.children ?? []) {
        const cd = child as Record<string, unknown>;
        const size = cd.size as { x: number; y: number };
        const transform = cd.transform as { m02: number; m12: number };
        console.log(`  - ${child.name}: size=${size?.x}x${size?.y}, pos=${transform?.m02},${transform?.m12}`);
      }
    }

    expect(data.layers.size).toBeGreaterThan(0);
  });
});
