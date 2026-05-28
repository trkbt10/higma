#!/usr/bin/env bun
/**
 * @file Generate shape fixture .fig file
 *
 * Creates a .fig file with various shape examples for testing:
 * - Ellipse: basic, circle, arc, donut
 * - Line: horizontal, diagonal, styled
 * - Star: 5-point, 8-point, custom inner radius
 * - Polygon: triangle, hexagon, octagon
 * - Vector: custom paths
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-shape-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
  updateNode,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { SolidPaintSpec } from "@higma-document-io/fig";

import type { FigColor, FigNode } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/shapes");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "shapes.fig");

function solidPaint(color: FigColor): SolidPaintSpec {
  return { type: "SOLID", color, opacity: 1, visible: true };
}

type ShapeChild = {
  type: "ellipse" | "line" | "star" | "polygon" | "rect";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: { r: number; g: number; b: number };
  stroke?: { r: number; g: number; b: number };
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  arcStart?: number;
  arcEnd?: number;
  innerRadius?: number;
  points?: number;
  starInnerRadius?: number;
  sides?: number;
  cornerRadius?: number;
  rotation?: number;
  strokeCap?: "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL";
  dashPattern?: number[];
};

type ShapeFrameData = {
  name: string;
  width: number;
  height: number;
  background: string;
  children: ShapeChild[];
};

function ellipseArcData(child: ShapeChild): NonNullable<FigNode["arcData"]> {
  return {
    startingAngle: ((child.arcStart ?? 0) * Math.PI) / 180,
    endingAngle: ((child.arcEnd ?? 360) * Math.PI) / 180,
    innerRadius: child.innerRadius ?? 0,
  };
}

/**
 * Stroke fields below pass plain string names through to the
 * builder. The builder lifts each to its Kiwi `value` once in
 * `createNodeFromSpec`, so this script no longer mirrors the
 * `STROKE_*_VALUES` tables or types `FigNode["strokeAlign"]` etc.
 * itself.
 */

/**
 * Inject `cornerRadius` directly onto the node when the spec API
 * does not expose it. `PolygonNodeSpec` and `StarNodeSpec` omit
 * `cornerRadius` even though the Kiwi schema accepts it on those
 * nodes, so we patch it post-addNode. Returns the same context when
 * no radius is requested.
 */
function injectCornerRadius(
  context: FigDocumentContext,
  nodeGuid: FigGuid,
  cornerRadius: number | undefined,
): FigDocumentContext {
  if (cornerRadius === undefined || cornerRadius <= 0) {
    return context;
  }
  return updateNode({
    context,
    nodeGuid,
    update: (n) => ({ ...n, cornerRadius }),
  });
}

const SHAPE_FRAMES: ShapeFrameData[] = [
  {
    name: "ellipse-basic", width: 160, height: 100, background: "#f0f0f0",
    children: [
      { type: "ellipse", name: "ellipse", x: 30, y: 20, width: 100, height: 60, fill: { r: 0.9, g: 0.3, b: 0.3 } },
    ],
  },
  {
    name: "ellipse-circle", width: 120, height: 120, background: "#f0f0f0",
    children: [
      { type: "ellipse", name: "circle", x: 20, y: 20, width: 80, height: 80, fill: { r: 0.3, g: 0.6, b: 0.9 } },
    ],
  },
  {
    name: "ellipse-arc", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "ellipse", name: "semicircle",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.3, g: 0.8, b: 0.3 },
        arcStart: 0, arcEnd: 180,
      },
    ],
  },
  {
    name: "ellipse-donut", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "ellipse", name: "donut",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.8, g: 0.5, b: 0.2 },
        innerRadius: 0.5,
      },
    ],
  },
  {
    name: "line-horizontal", width: 160, height: 40, background: "#f0f0f0",
    children: [
      {
        type: "line", name: "h-line",
        x: 20, y: 20, width: 120, height: 0,
        stroke: { r: 0, g: 0, b: 0 }, strokeWeight: 2,
      },
    ],
  },
  {
    name: "line-diagonal", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "line", name: "diag-line",
        x: 20, y: 20, width: 80, height: 0,
        stroke: { r: 0.2, g: 0.2, b: 0.8 }, strokeWeight: 2,
        rotation: 45,
      },
    ],
  },
  {
    name: "line-styled", width: 200, height: 80, background: "#f0f0f0",
    children: [
      { type: "line", name: "solid", x: 20, y: 20, width: 160, height: 0,
        stroke: { r: 0, g: 0, b: 0 }, strokeWeight: 2 },
      { type: "line", name: "dashed", x: 20, y: 40, width: 160, height: 0,
        stroke: { r: 0.5, g: 0, b: 0 }, strokeWeight: 2, dashPattern: [8, 4] },
      { type: "line", name: "dotted", x: 20, y: 60, width: 160, height: 0,
        stroke: { r: 0, g: 0.5, b: 0 }, strokeWeight: 2, dashPattern: [2, 4] },
    ],
  },
  {
    name: "star-5point", width: 120, height: 120, background: "#f0f0f0",
    children: [
      { type: "star", name: "5-star", x: 20, y: 20, width: 80, height: 80,
        fill: { r: 1, g: 0.8, b: 0 }, points: 5 },
    ],
  },
  {
    name: "star-8point", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "star", name: "8-star",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.9, g: 0.3, b: 0.7 }, points: 8, starInnerRadius: 0.4,
      },
    ],
  },
  {
    name: "star-sharp", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "star", name: "sharp-star",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.3, g: 0.3, b: 0.9 }, points: 6, starInnerRadius: 0.2,
      },
    ],
  },
  {
    name: "polygon-triangle", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "polygon", name: "triangle",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.9, g: 0.4, b: 0.4 }, sides: 3,
      },
    ],
  },
  {
    name: "polygon-hexagon", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "polygon", name: "hexagon",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.4, g: 0.7, b: 0.4 }, sides: 6,
      },
    ],
  },
  {
    name: "polygon-octagon", width: 120, height: 120, background: "#f0f0f0",
    children: [
      {
        type: "polygon", name: "octagon",
        x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.4, g: 0.4, b: 0.8 }, sides: 8,
      },
    ],
  },
  {
    name: "rect-rounded", width: 160, height: 100, background: "#f0f0f0",
    children: [
      {
        type: "rect", name: "rounded-rect",
        x: 20, y: 20, width: 120, height: 60,
        fill: { r: 0.5, g: 0.5, b: 0.5 }, cornerRadius: 10,
      },
    ],
  },
  {
    name: "rect-pill", width: 160, height: 80, background: "#f0f0f0",
    children: [
      {
        type: "rect", name: "pill",
        x: 20, y: 20, width: 120, height: 40,
        fill: { r: 0.2, g: 0.6, b: 0.9 }, cornerRadius: 20,
      },
    ],
  },
  {
    name: "shapes-mixed", width: 300, height: 120, background: "#ffffff",
    children: [
      { type: "ellipse", name: "circle", x: 20, y: 20, width: 80, height: 80,
        fill: { r: 0.9, g: 0.3, b: 0.3 } },
      { type: "star", name: "star", x: 110, y: 20, width: 80, height: 80,
        fill: { r: 1, g: 0.8, b: 0 }, points: 5 },
      {
        type: "polygon", name: "hex",
        x: 200, y: 20, width: 80, height: 80,
        fill: { r: 0.3, g: 0.6, b: 0.9 }, sides: 6,
      },
    ],
  },
  // Polygon + INSIDE stroke + cornerRadius — the configuration the
  // SVG renderer used to flatten to an axis-aligned `<rect rx>`
  // because the strokeshape branch over-promoted `kind:"rect"` for
  // any path node carrying a `cornerRadius`. count=3..6 walks the
  // shape axis; the corner-radius and stroke alignment are fixed so
  // a future drift is isolated to the polygon side.
  {
    name: "polygon-tri-stroke-cornered", width: 120, height: 120, background: "#ffffff",
    children: [
      {
        type: "polygon", name: "tri",
        x: 20, y: 20, width: 80, height: 80,
        sides: 3, cornerRadius: 6,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "INSIDE",
      },
    ],
  },
  {
    name: "polygon-diamond-stroke-cornered", width: 120, height: 120, background: "#ffffff",
    children: [
      {
        type: "polygon", name: "diamond",
        x: 20, y: 20, width: 80, height: 80,
        sides: 4, cornerRadius: 6,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "INSIDE",
      },
    ],
  },
  {
    name: "polygon-penta-stroke-cornered", width: 120, height: 120, background: "#ffffff",
    children: [
      {
        type: "polygon", name: "penta",
        x: 20, y: 20, width: 80, height: 80,
        sides: 5, cornerRadius: 6,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "INSIDE",
      },
    ],
  },
  {
    name: "polygon-hex-stroke-cornered", width: 120, height: 120, background: "#ffffff",
    children: [
      {
        type: "polygon", name: "hex",
        x: 20, y: 20, width: 80, height: 80,
        sides: 6, cornerRadius: 6,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "INSIDE",
      },
    ],
  },
  // Star + INSIDE stroke + cornerRadius. Star has its own
  // strokeshape path in the renderer; the polygon regression's
  // root cause (PathNode + cornerRadius) is shared and worth
  // exercising on this type too.
  {
    name: "star-stroke-cornered", width: 120, height: 120, background: "#ffffff",
    children: [
      {
        type: "star", name: "star",
        x: 20, y: 20, width: 80, height: 80,
        points: 5, starInnerRadius: 0.4, cornerRadius: 3,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "INSIDE",
      },
    ],
  },
  // OUTSIDE-stroke polygon — control case for the strokeshape
  // branch that handles OUTSIDE differently. Without an explicit
  // counter-example here, an INSIDE-only test would not catch a
  // regression that silently flips alignment.
  {
    name: "polygon-hex-stroke-outside", width: 140, height: 140, background: "#ffffff",
    children: [
      {
        type: "polygon", name: "hex",
        x: 30, y: 30, width: 80, height: 80,
        sides: 6, cornerRadius: 4,
        stroke: { r: 0.29, g: 0.73, b: 0.74 },
        strokeWeight: 2, strokeAlign: "OUTSIDE",
      },
    ],
  },
];

function hexToColor(hex: string): FigColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0.9, g: 0.9, b: 0.9, a: 1 };
  }
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
    a: 1,
  };
}

function rgbToColor(rgb: { r: number; g: number; b: number }): FigColor {
  return { ...rgb, a: 1 };
}

function addShapeChild(
  state: FigBuilderState,
  context: FigDocumentContext,
  pageGuid: FigGuid,
  parentGuid: ReturnType<typeof addNode>["nodeGuid"],
  child: ShapeChild,
): FigDocumentContext {
  const fillColor = rgbToColor(child.fill ?? { r: 0.8, g: 0.8, b: 0.8 });
  const fills = child.fill ? [solidPaint(fillColor)] : [];

  switch (child.type) {
    case "ellipse": {
      const r = addNode({
        state, context, pageGuid, parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "ELLIPSE",
          name: child.name,
          x: child.x, y: child.y,
          width: child.width, height: child.height,
          fills,
        },
      });
      if (child.arcStart !== undefined || child.arcEnd !== undefined || child.innerRadius !== undefined) {
        return updateNode({
          context: r.context,
          nodeGuid: r.nodeGuid,
          update: (n) => ({
            ...n,
            arcData: ellipseArcData(child),
          }),
        });
      }
      return r.context;
    }
    case "line": {
      const strokes = child.stroke ? [solidPaint(rgbToColor(child.stroke))] : [];
      const r = addNode({
        state, context, pageGuid, parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "LINE",
          name: child.name,
          x: child.x, y: child.y,
          width: child.width, height: 0,
          strokes,
          strokeWeight: child.strokeWeight,
          strokeCap: child.strokeCap,
          strokeDashes: child.dashPattern,
          rotation: child.rotation !== undefined ? (child.rotation * Math.PI) / 180 : undefined,
        },
      });
      return r.context;
    }
    case "star": {
      const strokes = child.stroke ? [solidPaint(rgbToColor(child.stroke))] : undefined;
      const result = addNode({
        state, context, pageGuid, parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "STAR",
          name: child.name,
          x: child.x, y: child.y,
          width: child.width, height: child.height,
          fills,
          strokes,
          strokeWeight: strokes ? (child.strokeWeight ?? 1) : undefined,
          strokeAlign: strokes ? (child.strokeAlign ?? "INSIDE") : undefined,
          strokeJoin: strokes ? "MITER" : undefined,
          pointCount: child.points,
          starInnerRadius: child.starInnerRadius,
        },
      });
      return injectCornerRadius(result.context, result.nodeGuid, child.cornerRadius);
    }
    case "polygon": {
      const strokes = child.stroke ? [solidPaint(rgbToColor(child.stroke))] : undefined;
      const result = addNode({
        state, context, pageGuid, parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "REGULAR_POLYGON",
          name: child.name,
          x: child.x, y: child.y,
          width: child.width, height: child.height,
          fills,
          strokes,
          strokeWeight: strokes ? (child.strokeWeight ?? 1) : undefined,
          strokeAlign: strokes ? (child.strokeAlign ?? "INSIDE") : undefined,
          strokeJoin: strokes ? "MITER" : undefined,
          pointCount: child.sides,
        },
      });
      return injectCornerRadius(result.context, result.nodeGuid, child.cornerRadius);
    }
    case "rect": {
      return addNode({
        state, context, pageGuid, parentGuid,
        spec: {
          visible: true,
          opacity: 1,
          type: "ROUNDED_RECTANGLE",
          name: child.name,
          x: child.x, y: child.y,
          width: child.width, height: child.height,
          fills,
          cornerRadius: child.cornerRadius,
        },
      }).context;
    }
  }
}

async function generateShapeFixtures(): Promise<void> {
  console.log("Generating shape fixtures...");

  const empty = createEmptyFigDocument("Shapes");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Shapes").guid;
  const doc0 = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const GRID_COLS = 4;
  const GRID_GAP = 30;
  const MARGIN = 50;

  const finalContext = SHAPE_FRAMES.reduce<FigDocumentContext>((acc, frameData, index) => {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const maxFrameWidth = 300;
    const maxFrameHeight = 150;
    const frameX = MARGIN + col * (maxFrameWidth + GRID_GAP);
    const frameY = MARGIN + row * (maxFrameHeight + GRID_GAP);
    const bgColor = hexToColor(frameData.background);

    const frameResult = addNode({
      state, context: acc, pageGuid, parentGuid: null,
      spec: {
        visible: true,
        opacity: 1,
        type: "FRAME",
        name: frameData.name,
        x: frameX, y: frameY,
        width: frameData.width, height: frameData.height,
        fills: [solidPaint(bgColor)],
        clipsContent: true,
      },
    });

    return frameData.children.reduce<FigDocumentContext>(
      (innerAcc, child) => addShapeChild(state, innerAcc, pageGuid, frameResult.nodeGuid, child),
      frameResult.context,
    );
  }, doc0);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const actualDir = path.join(OUTPUT_DIR, "actual");
  if (!fs.existsSync(actualDir)) {
    fs.mkdirSync(actualDir, { recursive: true });
  }

  const exported = await exportFig(finalContext);
  fs.writeFileSync(OUTPUT_FILE, exported.data);

  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Frames: ${SHAPE_FRAMES.length}`);
  console.log(`\nFrame list:`);
  for (const frame of SHAPE_FRAMES) {
    console.log(`  - ${frame.name} (${frame.width}x${frame.height})`);
  }

  console.log(`\nNext steps:`);
  console.log(`1. Open ${OUTPUT_FILE} in Figma`);
  console.log(`2. Adjust positions if needed`);
  console.log(`3. Export each frame as SVG to ${actualDir}/`);
  console.log(`4. Run: npx vitest run packages/@higma-document-renderers/fig/spec/shapes.spec.ts`);
}

generateShapeFixtures().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
