#!/usr/bin/env bun
/**
 * @file Generate frame-properties fixture .fig file
 *
 * Tests FRAME-level properties commonly missed in rendering:
 * - FRAME with background fill
 * - FRAME with corner radius + clip
 * - FRAME with opacity, effects, and stroke
 * - Nested FRAMEs with different fills
 * - INSTANCE inside FRAME
 * - FRAME overflow clipping
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-frame-properties-fixtures.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDocument,
  exportFig,
  requireCanvas,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import { BLEND_MODE_VALUES, EFFECT_TYPE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor, FigEffect, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/frame-properties");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "frame-properties.fig");

function solidPaint(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function solidPaintWithOpacity(color: FigColor, opacity: number): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function dropShadow(offsetX: number, offsetY: number, radius: number, color: FigColor): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.DROP_SHADOW, name: "DROP_SHADOW" },
    visible: true,
    color,
    offset: { x: offsetX, y: offsetY },
    radius,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

function innerShadow(offsetX: number, offsetY: number, radius: number, color: FigColor): FigEffect {
  return {
    type: { value: EFFECT_TYPE_VALUES.INNER_SHADOW, name: "INNER_SHADOW" },
    visible: true,
    color,
    offset: { x: offsetX, y: offsetY },
    radius,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

type AddFrameOptions = {
  fill?: { r: number; g: number; b: number };
  fillPaint?: FigPaint;
  cornerRadius?: number;
  opacity?: number;
  effects?: readonly FigEffect[];
  stroke?: { r: number; g: number; b: number; a: number };
  strokeWeight?: number;
};

type FrameBuildFn = (args: {
  context: FigDocumentContext;
  state: FigBuilderState;
  pageGuid: FigGuid;
  parentGuid: FigGuid;
}) => FigDocumentContext;

type AddedFrame = {
  readonly context: FigDocumentContext;
  readonly frameX: number;
};

function frameFills(opts: AddFrameOptions | undefined): FigPaint[] {
  if (opts?.fillPaint) {
    return [opts.fillPaint];
  }
  if (opts?.fill) {
    return [solidPaint({ ...opts.fill, a: 1 })];
  }
  return [];
}

function addFrame(
  args: {
    context: FigDocumentContext;
    state: FigBuilderState;
    pageGuid: FigGuid;
    name: string;
    width: number;
    height: number;
    frameX: number;
    buildFn: FrameBuildFn;
    opts?: AddFrameOptions;
  },
): AddedFrame {
  const { context, state, pageGuid, name, width, height, frameX, buildFn, opts } = args;
  const fills = frameFills(opts);
  const strokes: FigPaint[] = opts?.stroke ? [solidPaint(opts.stroke)] : [];

  const added = addNode({
    state,
    context,
    pageGuid,
    parentGuid: null,
    spec: {
      type: "FRAME",
      name,
      x: frameX,
      y: 0,
      width,
      height,
      fills,
      strokes,
      strokeWeight: opts?.strokeWeight,
      effects: opts?.effects,
      opacity: opts?.opacity,
      clipsContent: true,
      cornerRadius: opts?.cornerRadius,
    },
  });

  const contextAfterChildren = buildFn({
    context: added.context,
    state,
    pageGuid,
    parentGuid: added.nodeGuid,
  });
  return { context: contextAfterChildren, frameX: frameX + width + 20 };
}

async function generate(): Promise<void> {
  console.log("Generating frame-properties fixtures...");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const empty = createEmptyFigDocument("Frame Properties");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Frame Properties").guid;
  const doc0 = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  const startX = 0;

  // 1. FRAME with solid background fill
  const f1 = addFrame({
    context: doc0,
    state,
    pageGuid,
    name: "frame-bg-fill",
    width: 150,
    height: 100,
    frameX: startX,
    buildFn: ({ context, parentGuid }) => {
      return addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "inner",
          x: 20,
          y: 20,
          width: 60,
          height: 60,
          fills: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
        },
      }).context;
    },
    opts: { fill: { r: 0.2, g: 0.5, b: 0.9 } },
  });

  // 2. FRAME with corner radius + clip (card)
  const f2 = addFrame({
    context: f1.context,
    state,
    pageGuid,
    name: "frame-corner-clip",
    width: 150,
    height: 100,
    frameX: f1.frameX,
    buildFn: ({ context, parentGuid }) => {
      const r1 = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "overflow",
          x: -25,
          y: 10,
          width: 200,
          height: 40,
          fills: [solidPaint({ r: 0.2, g: 0.7, b: 0.4, a: 1 })],
        },
      });
      return addNode({
        state,
        context: r1.context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "content",
          x: 25,
          y: 60,
          width: 100,
          height: 30,
          fills: [solidPaint({ r: 0.3, g: 0.3, b: 0.3, a: 1 })],
        },
      }).context;
    },
    opts: { fill: { r: 1, g: 1, b: 1 }, cornerRadius: 16 },
  });

  // 3. Nested FRAMEs with different backgrounds
  const f3 = addFrame({
    context: f2.context,
    state,
    pageGuid,
    name: "frame-nested",
    width: 200,
    height: 150,
    frameX: f2.frameX,
    buildFn: ({ context, parentGuid }) => {
      const inner = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "FRAME",
          name: "inner-frame",
          x: 20,
          y: 20,
          width: 160,
          height: 110,
          fills: [solidPaint({ r: 0.9, g: 0.3, b: 0.3, a: 1 })],
          clipsContent: true,
        },
      });
      return addNode({
        state,
        context: inner.context,
        pageGuid,
        parentGuid: inner.nodeGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "deep-rect",
          x: 40,
          y: 25,
          width: 80,
          height: 60,
          fills: [solidPaint({ r: 0.2, g: 0.2, b: 0.9, a: 1 })],
        },
      }).context;
    },
    opts: { fill: { r: 0.95, g: 0.95, b: 0.95 } },
  });

  // 6. Children with drop shadow inside FRAME
  const f6 = addFrame({
    context: f3.context,
    state,
    pageGuid,
    name: "frame-child-effects",
    width: 200,
    height: 120,
    frameX: f3.frameX,
    buildFn: ({ context, parentGuid }) => {
      const r1 = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "shadow-rect",
          x: 20,
          y: 20,
          width: 100,
          height: 60,
          fills: [solidPaint({ r: 0.3, g: 0.5, b: 0.9, a: 1 })],
          cornerRadius: 8,
        },
      });
      return addNode({
        state,
        context: r1.context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "plain-rect",
          x: 130,
          y: 40,
          width: 60,
          height: 40,
          fills: [solidPaint({ r: 0.9, g: 0.2, b: 0.3, a: 1 })],
        },
      }).context;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  // 7. FRAME opacity with children
  const f7 = addFrame({
    context: f6.context,
    state,
    pageGuid,
    name: "frame-opacity",
    width: 150,
    height: 100,
    frameX: f6.frameX,
    buildFn: ({ context, parentGuid }) => {
      const r1 = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "opacity-child-a",
          x: 10,
          y: 15,
          width: 90,
          height: 70,
          fills: [solidPaint({ r: 0.1, g: 0.6, b: 0.9, a: 1 })],
          cornerRadius: 6,
        },
      });
      return addNode({
        state,
        context: r1.context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "opacity-child-b",
          x: 55,
          y: 25,
          width: 80,
          height: 60,
          fills: [solidPaint({ r: 0.95, g: 0.2, b: 0.25, a: 1 })],
          cornerRadius: 6,
        },
      }).context;
    },
    opts: { fill: { r: 1, g: 0.9, b: 0.2 }, opacity: 0.5 },
  });

  // 8. FRAME drop shadow effect
  const f8 = addFrame({
    context: f7.context,
    state,
    pageGuid,
    name: "frame-drop-shadow",
    width: 150,
    height: 100,
    frameX: f7.frameX,
    buildFn: ({ context, parentGuid }) => {
      return addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "drop-shadow-child",
          x: 35,
          y: 30,
          width: 80,
          height: 40,
          fills: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
          cornerRadius: 4,
        },
      }).context;
    },
    opts: {
      fillPaint: solidPaintWithOpacity({ r: 0.2, g: 0.45, b: 0.9, a: 1 }, 0.7),
      effects: [dropShadow(0, 6, 12, { r: 0, g: 0, b: 0, a: 0.35 })],
      cornerRadius: 10,
    },
  });

  // 9. FRAME inner shadow effect
  const f9 = addFrame({
    context: f8.context,
    state,
    pageGuid,
    name: "frame-inner-shadow",
    width: 150,
    height: 100,
    frameX: f8.frameX,
    buildFn: ({ context, parentGuid }) => {
      return addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "inner-shadow-child",
          x: 30,
          y: 29,
          width: 90,
          height: 42,
          fills: [solidPaintWithOpacity({ r: 1, g: 1, b: 1, a: 1 }, 0.85)],
          cornerRadius: 6,
        },
      }).context;
    },
    opts: {
      fill: { r: 0.9, g: 0.95, b: 1 },
      effects: [innerShadow(0, 4, 10, { r: 0, g: 0, b: 0, a: 0.4 })],
      cornerRadius: 12,
    },
  });

  // 10. FRAME stroke border
  const f10 = addFrame({
    context: f9.context,
    state,
    pageGuid,
    name: "frame-stroke",
    width: 150,
    height: 100,
    frameX: f9.frameX,
    buildFn: ({ context, parentGuid }) => {
      return addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "stroke-child",
          x: 30,
          y: 27,
          width: 90,
          height: 46,
          fills: [solidPaint({ r: 0.2, g: 0.7, b: 0.4, a: 1 })],
          cornerRadius: 6,
        },
      }).context;
    },
    opts: {
      fill: { r: 1, g: 1, b: 1 },
      stroke: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
      strokeWeight: 4,
      cornerRadius: 10,
    },
  });

  // 11. Multiple overlapping children (opacity compositing)
  const f11 = addFrame({
    context: f10.context,
    state,
    pageGuid,
    name: "frame-overlap",
    width: 150,
    height: 100,
    frameX: f10.frameX,
    buildFn: ({ context, parentGuid }) => {
      const r1 = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "rect-a",
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          fills: [solidPaint({ r: 0.9, g: 0.2, b: 0.2, a: 1 })],
        },
      });
      return addNode({
        state,
        context: r1.context,
        pageGuid,
        parentGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "rect-b",
          x: 60,
          y: 10,
          width: 80,
          height: 80,
          fills: [solidPaint({ r: 0.2, g: 0.2, b: 0.9, a: 1 })],
          opacity: 0.5,
        },
      }).context;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  // 12. Deep nested clip chain
  const f12 = addFrame({
    context: f11.context,
    state,
    pageGuid,
    name: "frame-deep-clip",
    width: 200,
    height: 150,
    frameX: f11.frameX,
    buildFn: ({ context, parentGuid }) => {
      const level1 = addNode({
        state,
        context,
        pageGuid,
        parentGuid,
        spec: {
          type: "FRAME",
          name: "level-1",
          x: 10,
          y: 10,
          width: 180,
          height: 130,
          fills: [solidPaint({ r: 0.9, g: 0.9, b: 0.95, a: 1 })],
          cornerRadius: 12,
          clipsContent: true,
        },
      });
      const level2 = addNode({
        state,
        context: level1.context,
        pageGuid,
        parentGuid: level1.nodeGuid,
        spec: {
          type: "FRAME",
          name: "level-2",
          x: 20,
          y: 20,
          width: 140,
          height: 90,
          fills: [solidPaint({ r: 0.85, g: 0.85, b: 0.92, a: 1 })],
          cornerRadius: 8,
          clipsContent: true,
        },
      });
      return addNode({
        state,
        context: level2.context,
        pageGuid,
        parentGuid: level2.nodeGuid,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "deep-overflow",
          x: -30,
          y: 20,
          width: 200,
          height: 50,
          fills: [solidPaint({ r: 0.2, g: 0.7, b: 0.4, a: 1 })],
        },
      }).context;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  const exported = await exportFig(f12.context);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Written: ${OUTPUT_FILE} (${exported.data.length} bytes)`);
  console.log("Done!");
  console.log("");
  console.log("Next steps:");
  console.log("1. Open frame-properties.fig in Figma");
  console.log("2. Export each frame as SVG to fixtures/frame-properties/actual/");
  console.log("3. Run comparison test");
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
