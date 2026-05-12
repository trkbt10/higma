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
  createEmptyFigDesignDocument,
  exportFig,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  FigDesignDocument,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigEffect, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/frame-properties");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "frame-properties.fig");

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function solidPaintWithOpacity(color: FigColor, opacity: number): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity,
    visible: true,
    blendMode: "NORMAL",
  };
}

function dropShadow(offsetX: number, offsetY: number, radius: number, color: FigColor): FigEffect {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color,
    offset: { x: offsetX, y: offsetY },
    radius,
    blendMode: "NORMAL",
  };
}

function innerShadow(offsetX: number, offsetY: number, radius: number, color: FigColor): FigEffect {
  return {
    type: "INNER_SHADOW",
    visible: true,
    color,
    offset: { x: offsetX, y: offsetY },
    radius,
    blendMode: "NORMAL",
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
  doc: FigDesignDocument;
  state: FigBuilderState;
  pageId: FigPageId;
  parentId: FigNodeId;
}) => FigDesignDocument;

type AddedFrame = {
  readonly doc: FigDesignDocument;
  readonly frameX: number;
};

function addFrame(
  args: {
    doc: FigDesignDocument;
    state: FigBuilderState;
    pageId: FigPageId;
    name: string;
    width: number;
    height: number;
    frameX: number;
    buildFn: FrameBuildFn;
    opts?: AddFrameOptions;
  },
): AddedFrame {
  const { doc, state, pageId, name, width, height, frameX, buildFn, opts } = args;
  const fills: FigPaint[] = [];
  if (opts?.fillPaint) {
    fills.push(opts.fillPaint);
  } else if (opts?.fill) {
    fills.push(solidPaint({ ...opts.fill, a: 1 }));
  }
  const strokes: FigPaint[] = opts?.stroke ? [solidPaint(opts.stroke)] : [];

  const added = addNode({
    state,
    doc,
    pageId,
    parentId: null,
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

  const docAfterChildren = buildFn({
    doc: added.doc,
    state,
    pageId,
    parentId: added.nodeId,
  });
  return { doc: docAfterChildren, frameX: frameX + width + 20 };
}

async function generate(): Promise<void> {
  console.log("Generating frame-properties fixtures...");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const empty = createEmptyFigDesignDocument("Frame Properties");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const doc0 = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  const startX = 0;

  // 1. FRAME with solid background fill
  const f1 = addFrame({
    doc: doc0,
    state,
    pageId,
    name: "frame-bg-fill",
    width: 150,
    height: 100,
    frameX: startX,
    buildFn: ({ doc, parentId }) => {
      return addNode({
        state,
        doc,
        pageId,
        parentId,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "inner",
          x: 20,
          y: 20,
          width: 60,
          height: 60,
          fills: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
        },
      }).doc;
    },
    opts: { fill: { r: 0.2, g: 0.5, b: 0.9 } },
  });

  // 2. FRAME with corner radius + clip (card)
  const f2 = addFrame({
    doc: f1.doc,
    state,
    pageId,
    name: "frame-corner-clip",
    width: 150,
    height: 100,
    frameX: f1.frameX,
    buildFn: ({ doc, parentId }) => {
      const r1 = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: r1.doc,
        pageId,
        parentId,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "content",
          x: 25,
          y: 60,
          width: 100,
          height: 30,
          fills: [solidPaint({ r: 0.3, g: 0.3, b: 0.3, a: 1 })],
        },
      }).doc;
    },
    opts: { fill: { r: 1, g: 1, b: 1 }, cornerRadius: 16 },
  });

  // 3. Nested FRAMEs with different backgrounds
  const f3 = addFrame({
    doc: f2.doc,
    state,
    pageId,
    name: "frame-nested",
    width: 200,
    height: 150,
    frameX: f2.frameX,
    buildFn: ({ doc, parentId }) => {
      const inner = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: inner.doc,
        pageId,
        parentId: inner.nodeId,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "deep-rect",
          x: 40,
          y: 25,
          width: 80,
          height: 60,
          fills: [solidPaint({ r: 0.2, g: 0.2, b: 0.9, a: 1 })],
        },
      }).doc;
    },
    opts: { fill: { r: 0.95, g: 0.95, b: 0.95 } },
  });

  // 6. Children with drop shadow inside FRAME
  const f6 = addFrame({
    doc: f3.doc,
    state,
    pageId,
    name: "frame-child-effects",
    width: 200,
    height: 120,
    frameX: f3.frameX,
    buildFn: ({ doc, parentId }) => {
      const r1 = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: r1.doc,
        pageId,
        parentId,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "plain-rect",
          x: 130,
          y: 40,
          width: 60,
          height: 40,
          fills: [solidPaint({ r: 0.9, g: 0.2, b: 0.3, a: 1 })],
        },
      }).doc;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  // 7. FRAME opacity with children
  const f7 = addFrame({
    doc: f6.doc,
    state,
    pageId,
    name: "frame-opacity",
    width: 150,
    height: 100,
    frameX: f6.frameX,
    buildFn: ({ doc, parentId }) => {
      const r1 = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: r1.doc,
        pageId,
        parentId,
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
      }).doc;
    },
    opts: { fill: { r: 1, g: 0.9, b: 0.2 }, opacity: 0.5 },
  });

  // 8. FRAME drop shadow effect
  const f8 = addFrame({
    doc: f7.doc,
    state,
    pageId,
    name: "frame-drop-shadow",
    width: 150,
    height: 100,
    frameX: f7.frameX,
    buildFn: ({ doc, parentId }) => {
      return addNode({
        state,
        doc,
        pageId,
        parentId,
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
      }).doc;
    },
    opts: {
      fillPaint: solidPaintWithOpacity({ r: 0.2, g: 0.45, b: 0.9, a: 1 }, 0.7),
      effects: [dropShadow(0, 6, 12, { r: 0, g: 0, b: 0, a: 0.35 })],
      cornerRadius: 10,
    },
  });

  // 9. FRAME inner shadow effect
  const f9 = addFrame({
    doc: f8.doc,
    state,
    pageId,
    name: "frame-inner-shadow",
    width: 150,
    height: 100,
    frameX: f8.frameX,
    buildFn: ({ doc, parentId }) => {
      return addNode({
        state,
        doc,
        pageId,
        parentId,
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
      }).doc;
    },
    opts: {
      fill: { r: 0.9, g: 0.95, b: 1 },
      effects: [innerShadow(0, 4, 10, { r: 0, g: 0, b: 0, a: 0.4 })],
      cornerRadius: 12,
    },
  });

  // 10. FRAME stroke border
  const f10 = addFrame({
    doc: f9.doc,
    state,
    pageId,
    name: "frame-stroke",
    width: 150,
    height: 100,
    frameX: f9.frameX,
    buildFn: ({ doc, parentId }) => {
      return addNode({
        state,
        doc,
        pageId,
        parentId,
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
      }).doc;
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
    doc: f10.doc,
    state,
    pageId,
    name: "frame-overlap",
    width: 150,
    height: 100,
    frameX: f10.frameX,
    buildFn: ({ doc, parentId }) => {
      const r1 = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: r1.doc,
        pageId,
        parentId,
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
      }).doc;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  // 12. Deep nested clip chain
  const f12 = addFrame({
    doc: f11.doc,
    state,
    pageId,
    name: "frame-deep-clip",
    width: 200,
    height: 150,
    frameX: f11.frameX,
    buildFn: ({ doc, parentId }) => {
      const level1 = addNode({
        state,
        doc,
        pageId,
        parentId,
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
        doc: level1.doc,
        pageId,
        parentId: level1.nodeId,
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
        doc: level2.doc,
        pageId,
        parentId: level2.nodeId,
        spec: {
          type: "ROUNDED_RECTANGLE",
          name: "deep-overflow",
          x: -30,
          y: 20,
          width: 200,
          height: 50,
          fills: [solidPaint({ r: 0.2, g: 0.7, b: 0.4, a: 1 })],
        },
      }).doc;
    },
    opts: { fill: { r: 1, g: 1, b: 1 } },
  });

  const exported = await exportFig(f12.doc);
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
