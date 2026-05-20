#!/usr/bin/env bun
/**
 * @file Generate fixtures/mask-and-vector/mask-and-vector.fig
 *
 * Closes two coverage holes the survey uncovered:
 *
 *   - `mask: true` was only present in the real Figma export
 *     `inherit.fig`. No project-built fixture exercises mask
 *     handling, so a regression in `mask` encoding/parsing would
 *     slip past every CI run.
 *   - VECTOR + SVG-path/`vectorData` was likewise inherit-only.
 *     This fixture emits a `vectorNode` with two SVG sub-paths so
 *     the path-blob and `fillGeometry` round-trip get exercised in
 *     a small, regenerable file.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-mask-and-vector-fixtures.ts
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
import { BLEND_MODE_VALUES, PAINT_TYPE_VALUES } from "@higma-document-models/fig/constants";
import type { FigGuid } from "@higma-document-models/fig/types";

import type { FigColor, FigPaint } from "@higma-document-models/fig/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/mask-and-vector");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "mask-and-vector.fig");

const FRAME_BG: FigColor = { r: 0.97, g: 0.97, b: 0.97, a: 1 };
const PHOTO_FILL: FigColor = { r: 0.55, g: 0.75, b: 0.95, a: 1 };
const VECTOR_FILL: FigColor = { r: 0.85, g: 0.4, b: 0.2, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: 1,
    visible: true,
    blendMode: { value: BLEND_MODE_VALUES.NORMAL, name: "NORMAL" },
  };
}

type AddedFrame = {
  readonly context: FigDocumentContext;
  readonly frameId: FigGuid;
};

function addFrame(
  context: FigDocumentContext,
  state: ReturnType<typeof createFigBuilderState>,
  pageGuid: FigGuid,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): AddedFrame {
  const result = addNode({
    state,
    context,
    pageGuid,
    parentGuid: null,
    spec: {
      type: "FRAME",
      name,
      x,
      y,
      width: w,
      height: h,
      fills: [solidPaint(FRAME_BG)],
      clipsContent: true,
    },
  });
  return { context: result.context, frameId: result.nodeGuid };
}

async function generate(): Promise<void> {
  console.log("Generating mask-and-vector fixture...");

  const empty = createEmptyFigDocument("Mask & Vector");
  const state = createFigBuilderState({
    nodeGuidCounter: { sessionID: 1, nextLocalID: 100 },
    pageGuidCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageGuid = requireCanvas(empty.document, "Mask & Vector").guid;
  const contextWithInternal = addPage({
    state,
    context: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).context;

  // Mask demo — a circular mask clipping a rectangle (the
  // canonical "avatar" pattern). The mask sibling has `mask: true`
  // and lives directly above its target in the parent's child
  // order so Figma's `applyMaskToSubsequent` semantics resolve.
  const maskFrame = addFrame(contextWithInternal, state, pageGuid, "mask-circle", 80, 80, 200, 200);

  // The mask itself: a circle. Add it FIRST so it sits at the
  // bottom of the child stack — Figma applies the mask to siblings
  // that come after it.
  const maskShape = addNode({
    state,
    context: maskFrame.context,
    pageGuid,
    parentGuid: maskFrame.frameId,
    spec: {
      type: "ELLIPSE",
      name: "mask-shape",
      x: 40,
      y: 40,
      width: 120,
      height: 120,
      fills: [solidPaint({ r: 1, g: 1, b: 1, a: 1 })],
    },
  });
  const maskApplied = updateNode({
    context: maskShape.context,
    nodeGuid: maskShape.nodeGuid,
    update: (n) => ({ ...n, mask: true }),
  });

  // The masked content: a coloured rectangle that should appear
  // clipped to the circle.
  const photo = addNode({
    state,
    context: maskApplied,
    pageGuid,
    parentGuid: maskFrame.frameId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "masked-photo",
      x: 20,
      y: 20,
      width: 160,
      height: 160,
      fills: [solidPaint(PHOTO_FILL)],
      cornerRadius: 4,
    },
  });

  // Vector demo — VECTOR node carrying two SVG path strings.
  const vectorFrame = addFrame(photo.context, state, pageGuid, "vector-paths", 320, 80, 200, 200);
  const vec = addNode({
    state,
    context: vectorFrame.context,
    pageGuid,
    parentGuid: vectorFrame.frameId,
    spec: {
      type: "VECTOR",
      name: "vector-arrow",
      x: 40,
      y: 40,
      width: 120,
      height: 120,
      fills: [solidPaint(VECTOR_FILL)],
      vectorPaths: [
        { windingRule: "NONZERO", data: "M 0 40 L 60 40 L 60 20 L 120 60 L 60 100 L 60 80 L 0 80 Z" },
        { windingRule: "NONZERO", data: "M 70 50 L 95 60 L 70 70 Z" },
      ],
    },
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const exported = await exportFig(vec.context);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Generated: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.length / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
