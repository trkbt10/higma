#!/usr/bin/env bun
/**
 * @file Generate fixtures/autolayout/autolayout.fig
 *
 * The layout fixture generator writes fixtures/layouts/layouts.fig.
 * This script owns the AutoLayout fixture set and preserves the existing
 * 12 exported layer names while adding Phase B coverage.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  exportFig,
  updateNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type {
  AutoLayoutProps,
  FigDesignDocument,
  FigGridTrackPositions,
  FigNodeId,
  FigPageId,
  LayoutConstraints,
} from "@higma-document-models/fig/domain";
import type { FigColor, FigPaint } from "@higma-document-models/fig/types";
import {
  STACK_ALIGN_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  type StackAlign,
  type StackJustify,
} from "@higma-document-models/fig/constants";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "../fixtures/autolayout");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "autolayout.fig");

const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const BG: FigColor = { r: 0.949, g: 0.949, b: 0.949, a: 1 };
const BLUE: FigColor = { r: 0.302, g: 0.302, b: 0.898, a: 1 };
const RED: FigColor = { r: 0.898, g: 0.302, b: 0.302, a: 1 };
const GREEN: FigColor = { r: 0.302, g: 0.898, b: 0.302, a: 1 };
const ORANGE: FigColor = { r: 1, g: 0.584, b: 0, a: 1 };
const PURPLE: FigColor = { r: 0.56, g: 0.33, b: 0.86, a: 1 };

function solidPaint(color: FigColor): FigPaint {
  return { type: "SOLID", color, opacity: 1, visible: true, blendMode: "NORMAL" };
}

// =============================================================================
// Specs
// =============================================================================

// `auto-grid-2x3` and `auto-wrap-3-rows` rely on Figma's GRID and
// WRAP stack modes respectively. The wrapping mode is plain
// HORIZONTAL with `stackWrap: true`; the grid mode requires the
// schema-level "GRID" enum value, which `STACK_MODE_VALUES` carries.
type StackMode = "HORIZONTAL" | "VERTICAL" | "GRID";

type StackSizing = "FIXED" | "RESIZE_TO_FIT";

type RectSpec = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: FigColor;
  readonly radius?: number;
  readonly primaryGrow?: number;
  readonly positioning?: "AUTO" | "ABSOLUTE";
};

type ExistingCase = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly autoLayout?: "HORIZONTAL" | "VERTICAL";
  readonly gap?: number;
  readonly padding?: number;
  readonly primaryAlign?: StackJustify;
  readonly counterAlign?: Extract<StackAlign, "MIN" | "CENTER" | "MAX">;
  readonly children: readonly RectSpec[];
};

const EXISTING_CASES: readonly ExistingCase[] = [
  {
    name: "simple-rects",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    children: [
      { name: "rect1", x: 20, y: 20, width: 60, height: 60, fill: BLUE },
      { name: "rect2", x: 100, y: 80, width: 80, height: 40, fill: RED },
    ],
  },
  {
    name: "auto-h-min",
    x: 240,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 0, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 0, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-center",
    x: 420,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    primaryAlign: "CENTER",
    counterAlign: "CENTER",
    children: [
      { name: "red", x: 0, y: 80, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 70, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 75, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-max",
    x: 600,
    y: 0,
    width: 140,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 10,
    primaryAlign: "MAX",
    counterAlign: "MAX",
    children: [
      { name: "red", x: 0, y: 160, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 50, y: 140, width: 40, height: 60, fill: GREEN, radius: 4 },
      { name: "blue", x: 100, y: 150, width: 40, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-min",
    x: 780,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 0, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 0, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-center",
    x: 1020,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    primaryAlign: "CENTER",
    counterAlign: "CENTER",
    children: [
      { name: "red", x: 80, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 70, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 75, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-v-max",
    x: 1260,
    y: 0,
    width: 200,
    height: 110,
    autoLayout: "VERTICAL",
    gap: 10,
    primaryAlign: "MAX",
    counterAlign: "MAX",
    children: [
      { name: "red", x: 160, y: 0, width: 40, height: 30, fill: RED, radius: 4 },
      { name: "green", x: 140, y: 40, width: 60, height: 30, fill: GREEN, radius: 4 },
      { name: "blue", x: 150, y: 80, width: 50, height: 30, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-h-space-between",
    x: 0,
    y: 240,
    width: 120,
    height: 200,
    autoLayout: "HORIZONTAL",
    primaryAlign: "SPACE_BETWEEN",
    counterAlign: "CENTER",
    children: [
      { name: "orange", x: 0, y: 80, width: 40, height: 40, fill: ORANGE, radius: 4 },
      { name: "lime", x: 40, y: 80, width: 40, height: 40, fill: GREEN, radius: 4 },
      { name: "sky", x: 80, y: 80, width: 40, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-gap-0",
    x: 240,
    y: 240,
    width: 150,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 0,
    children: [
      { name: "r1", x: 0, y: 0, width: 50, height: 50, fill: RED, radius: 4 },
      { name: "r2", x: 50, y: 0, width: 50, height: 50, fill: GREEN, radius: 4 },
      { name: "r3", x: 100, y: 0, width: 50, height: 50, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-gap-20",
    x: 400,
    y: 240,
    width: 160,
    height: 200,
    autoLayout: "HORIZONTAL",
    gap: 20,
    children: [
      { name: "red", x: 0, y: 0, width: 40, height: 40, fill: RED, radius: 4 },
      { name: "green", x: 60, y: 0, width: 40, height: 40, fill: GREEN, radius: 4 },
      { name: "blue", x: 120, y: 0, width: 40, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "auto-padding-20",
    x: 600,
    y: 240,
    width: 200,
    height: 88,
    autoLayout: "VERTICAL",
    gap: 8,
    children: [
      { name: "r1", x: 0, y: 0, width: 80, height: 40, fill: PURPLE, radius: 4 },
      { name: "r2", x: 0, y: 48, width: 80, height: 40, fill: BLUE, radius: 4 },
    ],
  },
  {
    name: "constraints-corners",
    x: 780,
    y: 240,
    width: 200,
    height: 200,
    children: [
      { name: "tl", x: 10, y: 10, width: 30, height: 30, fill: RED },
      { name: "tr", x: 160, y: 10, width: 30, height: 30, fill: GREEN },
      { name: "c", x: 85, y: 85, width: 30, height: 30, fill: ORANGE },
      { name: "bl", x: 10, y: 160, width: 30, height: 30, fill: BLUE },
      { name: "br", x: 160, y: 160, width: 30, height: 30, fill: PURPLE },
    ],
  },
];

// =============================================================================
// Builder helpers
// =============================================================================

type Ctx = {
  readonly state: FigBuilderState;
  readonly pageId: FigPageId;
};

/** Build a uniform padding box `{top, right, bottom, left}`. */
function uniformPadding(p: number): { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } {
  return { top: p, right: p, bottom: p, left: p };
}

type AutoLayoutInput = {
  readonly mode: StackMode;
  readonly gap?: number;
  readonly counterGap?: number;
  readonly padding?:
    | number
    | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly primaryAlign?: StackJustify;
  readonly counterAlign?: Extract<StackAlign, "MIN" | "CENTER" | "MAX">;
  readonly contentAlign?: Extract<StackAlign, "MIN" | "CENTER" | "MAX">;
  readonly wrap?: boolean;
  readonly reverseZIndex?: boolean;
};

function buildAutoLayout(input: AutoLayoutInput): AutoLayoutProps {
  const padding = typeof input.padding === "number" ? uniformPadding(input.padding) : input.padding;
  return {
    stackMode: { value: STACK_MODE_VALUES[input.mode], name: input.mode },
    stackSpacing: input.gap,
    stackCounterSpacing: input.counterGap,
    stackPadding: padding,
    stackPrimaryAlignItems: input.primaryAlign
      ? { value: STACK_JUSTIFY_VALUES[input.primaryAlign], name: input.primaryAlign }
      : undefined,
    stackCounterAlignItems: input.counterAlign
      ? { value: STACK_ALIGN_VALUES[input.counterAlign], name: input.counterAlign }
      : undefined,
    stackPrimaryAlignContent: input.contentAlign
      ? { value: STACK_ALIGN_VALUES[input.contentAlign], name: input.contentAlign }
      : undefined,
    stackWrap: input.wrap,
    stackReverseZIndex: input.reverseZIndex,
  };
}

function sizingConstraint(sizing: StackSizing): { readonly value: number; readonly name: StackSizing } {
  return { value: STACK_SIZING_VALUES[sizing], name: sizing };
}

type FrameOpts = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly background: FigColor;
  readonly autoLayout?: AutoLayoutInput;
  readonly stroke?: FigColor;
  readonly strokeWeight?: number;
};

type AddedFrame = { readonly doc: FigDesignDocument; readonly frameId: FigNodeId };

function addFrame(
  doc: FigDesignDocument,
  ctx: Ctx,
  parentId: FigNodeId | null,
  opts: FrameOpts,
): AddedFrame {
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "FRAME",
      name: opts.name,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      fills: [solidPaint(opts.background)],
      strokes: opts.stroke ? [solidPaint(opts.stroke)] : undefined,
      strokeWeight: opts.strokeWeight,
      autoLayout: opts.autoLayout ? buildAutoLayout(opts.autoLayout) : undefined,
    },
  });
  return { doc: r.doc, frameId: r.nodeId };
}

function addRect(
  doc: FigDesignDocument,
  ctx: Ctx,
  parentId: FigNodeId,
  spec: RectSpec,
): FigDesignDocument {
  const layoutConstraints: LayoutConstraints = {};
  const constraints: LayoutConstraints = {
    ...layoutConstraints,
    ...(spec.primaryGrow !== undefined ? { stackChildPrimaryGrow: spec.primaryGrow } : {}),
    ...(spec.positioning !== undefined
      ? {
          stackPositioning: {
            value: STACK_POSITIONING_VALUES[spec.positioning],
            name: spec.positioning,
          },
        }
      : {}),
  };
  const r = addNode({
    state: ctx.state,
    doc,
    pageId: ctx.pageId,
    parentId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: spec.name,
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
      fills: [solidPaint(spec.fill)],
      cornerRadius: spec.radius ?? 0,
      ...(Object.keys(constraints).length > 0 ? { layoutConstraints: constraints } : {}),
    },
  });
  return r.doc;
}

function addExistingCase(doc: FigDesignDocument, ctx: Ctx, item: ExistingCase): FigDesignDocument {
  const frame = addFrame(doc, ctx, null, {
    name: item.name,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    background: BG,
    autoLayout: item.autoLayout
      ? {
          mode: item.autoLayout,
          gap: item.gap,
          padding: item.padding,
          primaryAlign: item.primaryAlign,
          counterAlign: item.counterAlign,
        }
      : undefined,
  });
  return item.children.reduce<FigDesignDocument>(
    (acc, child) => addRect(acc, ctx, frame.frameId, child),
    frame.doc,
  );
}

/**
 * Build a `FigGridTrackPositions` value with `count` track entries.
 *
 * Kiwi schema: each entry is `GUIDGridTrackSizeMapEntry { id: GUID,
 * trackSize: GridTrackSize }`. The renderer's GRID solver only
 * consults `entries.length` today, so `trackSize` is intentionally
 * omitted — the Kiwi encoder treats missing optional message fields
 * as default values on round-trip.
 */
function gridTrackEntries(count: number): FigGridTrackPositions {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      id: { sessionID: 1, localID: 9000 + index },
    })),
  };
}

// =============================================================================
// Phase B fixtures
// =============================================================================

function addPhaseBFixtures(doc: FigDesignDocument, ctx: Ctx): FigDesignDocument {
  const startY = 520;

  // ── 1. auto-grid-2x3 ─────────────────────────────────────────────────────
  const grid = addFrame(doc, ctx, null, {
    name: "auto-grid-2x3",
    x: 0,
    y: startY,
    width: 124,
    height: 138,
    background: WHITE,
    autoLayout: {
      mode: "GRID",
      gap: 12,
      counterGap: 8,
      padding: 16,
    },
  });
  const gridWithTracks = updateNode({
    doc: grid.doc,
    pageId: ctx.pageId,
    nodeId: grid.frameId,
    updater: (n) => ({
      ...n,
      // The Kiwi schema models gridColumns / gridRows as single
      // `GridTrackPositions` messages (one struct, not an array). The
      // domain type widens this to `readonly unknown[]` only because
      // grid-position handling is round-trip-only in the domain — we
      // intentionally pass the canonical single-struct shape here and
      // cast at the boundary.
      gridColumns: gridTrackEntries(2),
      gridRows: gridTrackEntries(3),
      gridColumnGap: 12,
      gridRowGap: 8,
    }),
  });
  const gridFilled = [0, 1, 2, 3, 4, 5].reduce<FigDesignDocument>((acc, index) => {
    const colors = [RED, GREEN, BLUE, ORANGE, PURPLE, BLUE];
    return addRect(acc, ctx, grid.frameId, {
      name: `cell-${index + 1}`,
      x: 0,
      y: 0,
      width: 40,
      height: 30,
      fill: colors[index],
      radius: 4,
    });
  }, gridWithTracks);

  // ── 2. auto-wrap-3-rows ─────────────────────────────────────────────────
  const wrap = addFrame(gridFilled, ctx, null, {
    name: "auto-wrap-3-rows",
    x: 180,
    y: startY,
    width: 130,
    height: 160,
    background: WHITE,
    autoLayout: {
      mode: "HORIZONTAL",
      gap: 10,
      counterGap: 8,
      wrap: true,
      contentAlign: "CENTER",
      counterAlign: "CENTER",
    },
  });
  const wrapFilled = [0, 1, 2, 3, 4].reduce<FigDesignDocument>((acc, index) => {
    const colors = [RED, GREEN, BLUE, ORANGE, PURPLE];
    return addRect(acc, ctx, wrap.frameId, {
      name: `wrap-${index + 1}`,
      x: 0,
      y: 0,
      width: 60,
      height: 20,
      fill: colors[index],
      radius: 4,
    });
  }, wrap.doc);

  // ── 3. auto-hug-h ────────────────────────────────────────────────────────
  const hugH = addFrame(wrapFilled, ctx, null, {
    name: "auto-hug-h",
    x: 360,
    y: startY,
    width: 136,
    height: 46,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: 10, padding: 8 },
  });
  const hugHSized = updateNode({
    doc: hugH.doc,
    pageId: ctx.pageId,
    nodeId: hugH.frameId,
    updater: (n) => ({
      ...n,
      layoutConstraints: {
        ...(n.layoutConstraints ?? {}),
        stackPrimarySizing: sizingConstraint("RESIZE_TO_FIT"),
        stackCounterSizing: sizingConstraint("RESIZE_TO_FIT"),
      },
    }),
  });
  const hugHFilled = ([
    { name: "a", fill: RED, w: 30, h: 20 },
    { name: "b", fill: GREEN, w: 50, h: 30 },
    { name: "c", fill: BLUE, w: 20, h: 25 },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, hugH.frameId, { name: c.name, x: 0, y: 0, width: c.w, height: c.h, fill: c.fill, radius: 4 }),
    hugHSized,
  );

  // ── 4. auto-hug-v ────────────────────────────────────────────────────────
  const hugV = addFrame(hugHFilled, ctx, null, {
    name: "auto-hug-v",
    x: 520,
    y: startY,
    width: 66,
    height: 111,
    background: WHITE,
    autoLayout: { mode: "VERTICAL", gap: 10, padding: 8 },
  });
  const hugVSized = updateNode({
    doc: hugV.doc,
    pageId: ctx.pageId,
    nodeId: hugV.frameId,
    updater: (n) => ({
      ...n,
      layoutConstraints: {
        ...(n.layoutConstraints ?? {}),
        stackPrimarySizing: sizingConstraint("RESIZE_TO_FIT"),
        stackCounterSizing: sizingConstraint("RESIZE_TO_FIT"),
      },
    }),
  });
  const hugVFilled = ([
    { name: "a", fill: RED, w: 30, h: 20 },
    { name: "b", fill: GREEN, w: 50, h: 30 },
    { name: "c", fill: BLUE, w: 20, h: 25 },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, hugV.frameId, { name: c.name, x: 0, y: 0, width: c.w, height: c.h, fill: c.fill, radius: 4 }),
    hugVSized,
  );

  // ── 5. auto-fill-grow ────────────────────────────────────────────────────
  const grow = addFrame(hugVFilled, ctx, null, {
    name: "auto-fill-grow",
    x: 640,
    y: startY,
    width: 200,
    height: 60,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: 10, padding: 10 },
  });
  const growFilled = ([
    { name: "fixed-a", fill: RED, w: 40, h: 30 },
    { name: "grow", fill: GREEN, w: 10, h: 30, primaryGrow: 1 },
    { name: "fixed-b", fill: BLUE, w: 50, h: 30 },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) =>
      addRect(acc, ctx, grow.frameId, {
        name: c.name,
        x: 0,
        y: 0,
        width: c.w,
        height: c.h,
        fill: c.fill,
        radius: 4,
        primaryGrow: "primaryGrow" in c ? c.primaryGrow : undefined,
      }),
    grow.doc,
  );

  // ── 6. auto-min-clamp ───────────────────────────────────────────────────
  const minF = addFrame(growFilled, ctx, null, {
    name: "auto-min-clamp",
    x: 880,
    y: startY,
    width: 200,
    height: 120,
    background: WHITE,
    autoLayout: { mode: "VERTICAL", gap: 4, padding: 10 },
  });
  const minFPatched = updateNode({
    doc: minF.doc,
    pageId: ctx.pageId,
    nodeId: minF.frameId,
    updater: (n) => ({
      ...n,
      minSize: { x: 200, y: 120 },
      layoutConstraints: {
        ...(n.layoutConstraints ?? {}),
        stackPrimarySizing: sizingConstraint("RESIZE_TO_FIT"),
        stackCounterSizing: sizingConstraint("RESIZE_TO_FIT"),
      },
    }),
  });
  const minFFilled = ([
    { name: "short-a", fill: RED, w: 60, h: 30 },
    { name: "short-b", fill: GREEN, w: 60, h: 20 },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, minF.frameId, { name: c.name, x: 0, y: 0, width: c.w, height: c.h, fill: c.fill, radius: 4 }),
    minFPatched,
  );

  // ── 7. auto-max-clamp ───────────────────────────────────────────────────
  const maxF = addFrame(minFFilled, ctx, null, {
    name: "auto-max-clamp",
    x: 1120,
    y: startY,
    width: 80,
    height: 240,
    background: WHITE,
    autoLayout: { mode: "VERTICAL", gap: 8, padding: 10 },
  });
  const maxFPatched = updateNode({
    doc: maxF.doc,
    pageId: ctx.pageId,
    nodeId: maxF.frameId,
    updater: (n) => ({
      ...n,
      maxSize: { x: 200, y: 240 },
      layoutConstraints: {
        ...(n.layoutConstraints ?? {}),
        stackPrimarySizing: sizingConstraint("RESIZE_TO_FIT"),
        stackCounterSizing: sizingConstraint("RESIZE_TO_FIT"),
      },
    }),
  });
  const maxFFilled = [0, 1, 2].reduce<FigDesignDocument>((acc, index) => {
    const colors = [RED, GREEN, BLUE];
    return addRect(acc, ctx, maxF.frameId, {
      name: `tall-${index + 1}`,
      x: 0,
      y: 0,
      width: 60,
      height: 100,
      fill: colors[index],
      radius: 4,
    });
  }, maxFPatched);

  // ── 8. auto-aspect-lock ─────────────────────────────────────────────────
  const aspect = addFrame(maxFFilled, ctx, null, {
    name: "auto-aspect-lock",
    x: 0,
    y: startY + 220,
    width: 320,
    height: 180,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", padding: 20 },
  });
  const aspectPatched = updateNode({
    doc: aspect.doc,
    pageId: ctx.pageId,
    nodeId: aspect.frameId,
    updater: (n) => ({
      ...n,
      // 16:9 ratio — Figma stores the lock as a target vector.
      targetAspectRatio: { x: 16, y: 9 },
      proportionsConstrained: true,
    }),
  });
  const aspectFilled = addRect(aspectPatched, ctx, aspect.frameId, {
    name: "child",
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    fill: BLUE,
    radius: 4,
  });

  // ── 9. auto-strokes-on / auto-strokes-off ───────────────────────────────
  const strokesDoc = [true, false].reduce<FigDesignDocument>((acc, takeSpace, index) => {
    const frame = addFrame(acc, ctx, null, {
      name: takeSpace ? "auto-strokes-on" : "auto-strokes-off",
      x: 360 + index * 180,
      y: startY + 220,
      width: 140,
      height: 80,
      background: WHITE,
      stroke: BLUE,
      strokeWeight: 8,
      autoLayout: { mode: "HORIZONTAL", padding: 8 },
    });
    const patched = updateNode({
      doc: frame.doc,
      pageId: ctx.pageId,
      nodeId: frame.frameId,
      updater: (n) => ({ ...n, bordersTakeSpace: takeSpace }),
    });
    return addRect(patched, ctx, frame.frameId, {
      name: "child",
      x: 0,
      y: 0,
      width: 40,
      height: 30,
      fill: RED,
      radius: 4,
    });
  }, aspectFilled);

  // ── 10. auto-z-reverse ──────────────────────────────────────────────────
  const reverse = addFrame(strokesDoc, ctx, null, {
    name: "auto-z-reverse",
    x: 720,
    y: startY + 220,
    width: 140,
    height: 70,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: -20, reverseZIndex: true },
  });
  const reverseFilled = ([
    { name: "bottom-authored-first", fill: RED },
    { name: "middle", fill: GREEN },
    { name: "top-authored-last", fill: BLUE },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, reverse.frameId, { name: c.name, x: 0, y: 0, width: 60, height: 50, fill: c.fill, radius: 4 }),
    reverse.doc,
  );

  // ── 11. auto-absolute-mix ───────────────────────────────────────────────
  const abs = addFrame(reverseFilled, ctx, null, {
    name: "auto-absolute-mix",
    x: 900,
    y: startY + 220,
    width: 190,
    height: 80,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: 10, padding: 10 },
  });
  const absFilled = ([
    { name: "flow-a", x: 0, y: 0, fill: RED },
    { name: "flow-b", x: 0, y: 0, fill: GREEN },
    { name: "flow-c", x: 0, y: 0, fill: BLUE },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, abs.frameId, { name: c.name, x: c.x, y: c.y, width: 40, height: 30, fill: c.fill, radius: 4 }),
    abs.doc,
  );
  const absFinal = addRect(absFilled, ctx, abs.frameId, {
    name: "absolute",
    x: 120,
    y: 35,
    width: 50,
    height: 30,
    fill: ORANGE,
    radius: 4,
    positioning: "ABSOLUTE",
  });

  // ── 12. auto-padding-asym ───────────────────────────────────────────────
  const asym = addFrame(absFinal, ctx, null, {
    name: "auto-padding-asym",
    x: 1140,
    y: startY + 220,
    width: 128,
    height: 60,
    background: WHITE,
    autoLayout: { mode: "VERTICAL", padding: { left: 4, right: 24, top: 12, bottom: 8 } },
  });
  const asymFilled = addRect(asym.doc, ctx, asym.frameId, {
    name: "full-inner",
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    fill: GREEN,
    radius: 4,
  });

  // ── 13. auto-nested ─────────────────────────────────────────────────────
  const nested = addFrame(asymFilled, ctx, null, {
    name: "auto-nested",
    x: 0,
    y: startY + 440,
    width: 260,
    height: 130,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: 16, padding: 12 },
  });
  const leftHug = addFrame(nested.doc, ctx, nested.frameId, {
    name: "left-hug",
    x: 0,
    y: 0,
    width: 66,
    height: 76,
    background: BG,
    autoLayout: { mode: "VERTICAL", gap: 8, padding: 8 },
  });
  const leftHugSized = updateNode({
    doc: leftHug.doc,
    pageId: ctx.pageId,
    nodeId: leftHug.frameId,
    updater: (n) => ({
      ...n,
      layoutConstraints: {
        ...(n.layoutConstraints ?? {}),
        stackPrimarySizing: sizingConstraint("RESIZE_TO_FIT"),
        stackCounterSizing: sizingConstraint("RESIZE_TO_FIT"),
      },
    }),
  });
  const leftHugFilled = ([
    { name: "left-a", w: 50, h: 24, fill: RED },
    { name: "left-b", w: 30, h: 28, fill: GREEN },
  ] as const).reduce<FigDesignDocument>(
    (acc, c) => addRect(acc, ctx, leftHug.frameId, { name: c.name, x: 0, y: 0, width: c.w, height: c.h, fill: c.fill, radius: 4 }),
    leftHugSized,
  );

  const rightGrid = addFrame(leftHugFilled, ctx, nested.frameId, {
    name: "right-grid",
    x: 0,
    y: 0,
    width: 92,
    height: 92,
    background: BG,
    autoLayout: { mode: "GRID", gap: 8, counterGap: 8, padding: 8 },
  });
  const rightGridWithTracks = updateNode({
    doc: rightGrid.doc,
    pageId: ctx.pageId,
    nodeId: rightGrid.frameId,
    updater: (n) => ({
      ...n,
      gridColumns: gridTrackEntries(2),
      gridRows: gridTrackEntries(2),
    }),
  });
  const rightGridFilled = [0, 1, 2, 3].reduce<FigDesignDocument>((acc, index) => {
    const colors = [BLUE, ORANGE, PURPLE, GREEN];
    return addRect(acc, ctx, rightGrid.frameId, {
      name: `right-${index + 1}`,
      x: 0,
      y: 0,
      width: 34,
      height: 34,
      fill: colors[index],
      radius: 4,
    });
  }, rightGridWithTracks);

  // ── 14. auto-stretch-counter ────────────────────────────────────────────
  const stretch = addFrame(rightGridFilled, ctx, null, {
    name: "auto-stretch-counter",
    x: 320,
    y: startY + 440,
    width: 180,
    height: 90,
    background: WHITE,
    autoLayout: { mode: "HORIZONTAL", gap: 12, padding: 10, counterAlign: "MIN" },
  });
  const stretchChild = addNode({
    state: ctx.state,
    doc: stretch.doc,
    pageId: ctx.pageId,
    parentId: stretch.frameId,
    spec: {
      type: "FRAME",
      name: "stretch-child",
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      fills: [solidPaint(PURPLE)],
      layoutConstraints: {
        stackChildAlignSelf: {
          value: STACK_COUNTER_ALIGN_VALUES.STRETCH,
          name: "STRETCH",
        },
      },
    },
  });
  return addRect(stretchChild.doc, ctx, stretch.frameId, {
    name: "fixed-child",
    x: 0,
    y: 0,
    width: 50,
    height: 30,
    fill: BLUE,
    radius: 4,
  });
}

async function generate(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const empty = createEmptyFigDesignDocument("AutoLayout");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const pageId = empty.pages[0]!.id;
  const ctx: Ctx = { state, pageId };
  const doc0 = addPage({
    state,
    doc: empty,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  const afterExisting = EXISTING_CASES.reduce<FigDesignDocument>(
    (acc, item) => addExistingCase(acc, ctx, item),
    doc0,
  );
  const finalDoc = addPhaseBFixtures(afterExisting, ctx);

  const exported = await exportFig(finalDoc);
  fs.writeFileSync(OUTPUT_FILE, exported.data);
  console.log(`Written: ${OUTPUT_FILE}`);
  console.log(`Size: ${(exported.data.byteLength / 1024).toFixed(1)} KB`);
}

generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
