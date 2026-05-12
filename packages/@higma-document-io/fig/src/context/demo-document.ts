/**
 * @file Demo .fig document builder
 *
 * Builds a rich demo FigDesignDocument that showcases the fig renderer's
 * capabilities. Constructs the document directly via the canonical
 * `@higma-document-io/fig` builder helpers (`createEmptyFigDesignDocument`
 * + `addNode` + `addPage` + `updateNode`); no fig-file binary round-trip
 * is involved.
 *
 * Demonstrates:
 * - Multiple artboards (pages)
 * - Component (SYMBOL) definitions and INSTANCE inheritance
 * - Shapes: rectangle, ellipse, star, polygon, line
 * - Text: centering, multi-line, varied fonts and sizes
 * - Effects: drop shadow, inner shadow, layer blur
 * - Fills: solid colors, linear/radial gradients
 * - Strokes: solid, dashed
 */

import {
  addNode,
  addPage,
  createEmptyFigDesignDocument,
  updateNode,
} from "@higma-document-io/fig";
import { createFigBuilderState } from "@higma-document-models/fig/builder";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import type { NodeSpec } from "@higma-document-io/fig/types";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigNodeId,
  FigPageId,
} from "@higma-document-models/fig/domain";
import type {
  FigColor,
  FigEffect,
  FigGradientStop,
  FigGradientTransform,
  FigPaint,
} from "@higma-document-models/fig/types";
import {
  NUMBER_UNITS_VALUES,
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  TEXT_ALIGN_H_VALUES,
  TEXT_ALIGN_V_VALUES,
  TEXT_AUTO_RESIZE_VALUES,
} from "@higma-document-models/fig/constants";

// =============================================================================
// Color Palette
// =============================================================================

const BLUE: FigColor = { r: 0.24, g: 0.47, b: 0.85, a: 1 };
const RED: FigColor = { r: 0.90, g: 0.25, b: 0.25, a: 1 };
const GREEN: FigColor = { r: 0.22, g: 0.72, b: 0.45, a: 1 };
const ORANGE: FigColor = { r: 0.95, g: 0.55, b: 0.15, a: 1 };
const PURPLE: FigColor = { r: 0.55, g: 0.30, b: 0.85, a: 1 };
const DARK: FigColor = { r: 0.15, g: 0.15, b: 0.20, a: 1 };
const GRAY: FigColor = { r: 0.55, g: 0.55, b: 0.60, a: 1 };
const LIGHT_GRAY: FigColor = { r: 0.92, g: 0.92, b: 0.93, a: 1 };
const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };

// =============================================================================
// Paint Helpers
// =============================================================================

function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

/**
 * Compute the Kiwi `transform` matrix that maps gradient space → the
 * shape's normalized [0,1]×[0,1] space, for a linear gradient travelling
 * from (startX, startY) to (endX, endY). Matches the math used by the
 * legacy `fig-file` builder so visual output stays equivalent to what
 * the old `linearGradient().angle(...)` chain produced.
 */
function linearHandlesToTransform(
  start: { x: number; y: number },
  end: { x: number; y: number },
): FigGradientTransform {
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  return {
    m00: dx,
    m01: -dy,
    m02: end.x,
    m10: dy,
    m11: dx,
    m12: end.y,
  };
}

/**
 * Translate a CSS-style angle (0° = right, 90° = down, ...) into the
 * shape-normalized [start, end] handle pair the gradient encoder needs.
 * Mirrors the math the legacy `linearGradient().angle()` chain used.
 */
function angleHandles(degrees: number): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    start: { x: 0.5 - cos * 0.5, y: 0.5 - sin * 0.5 },
    end: { x: 0.5 + cos * 0.5, y: 0.5 + sin * 0.5 },
  };
}

function linearGradientPaint(angleDeg: number, stops: readonly FigGradientStop[]): FigPaint {
  const { start, end } = angleHandles(angleDeg);
  return {
    type: "GRADIENT_LINEAR",
    stops,
    transform: linearHandlesToTransform(start, end),
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function radialGradientPaint(stops: readonly FigGradientStop[]): FigPaint {
  return {
    type: "GRADIENT_RADIAL",
    stops,
    // Default radial gradient: centered at (0.5, 0.5) with radius 0.5 along
    // both axes. Matches the old builder's `radialGradient()` defaults.
    transform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 0.5, m12: 0.5 },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

// =============================================================================
// Effect Helpers
// =============================================================================

type ShadowOpts = {
  readonly offset: { readonly x: number; readonly y: number };
  readonly radius: number;
  readonly color: FigColor;
  readonly spread?: number;
};

function dropShadowEffect(opts: ShadowOpts): FigEffect {
  return {
    type: "DROP_SHADOW",
    visible: true,
    color: opts.color,
    offset: opts.offset,
    radius: opts.radius,
    spread: opts.spread,
    blendMode: "NORMAL",
  };
}

function innerShadowEffect(opts: ShadowOpts): FigEffect {
  return {
    type: "INNER_SHADOW",
    visible: true,
    color: opts.color,
    offset: opts.offset,
    radius: opts.radius,
    spread: opts.spread,
    blendMode: "NORMAL",
  };
}

function layerBlurEffect(radius: number): FigEffect {
  return {
    type: "LAYER_BLUR",
    visible: true,
    radius,
  };
}

// =============================================================================
// Build Context
// =============================================================================

type BuildContext = {
  readonly state: FigBuilderState;
  readonly doc: FigDesignDocument;
  readonly pageId: FigPageId;
};

type AddOptions = {
  readonly ctx: BuildContext;
  readonly parentId: FigNodeId | null;
  readonly spec: NodeSpec;
};

type AddResult = {
  readonly doc: FigDesignDocument;
  readonly nodeId: FigNodeId;
};

function add({ ctx, parentId, spec }: AddOptions): AddResult {
  return addNode({ state: ctx.state, doc: ctx.doc, pageId: ctx.pageId, parentId, spec });
}

function withDoc(ctx: BuildContext, doc: FigDesignDocument): BuildContext {
  return { ...ctx, doc };
}

// Set fields on a node that the NodeSpec surface doesn't expose
// (textAutoResize on the text data, PERCENT-unit line heights, etc.).
function patchNode(
  ctx: BuildContext,
  nodeId: FigNodeId,
  updater: (node: FigDesignNode) => FigDesignNode,
): FigDesignDocument {
  return updateNode({ doc: ctx.doc, pageId: ctx.pageId, nodeId, updater });
}

// =============================================================================
// Text Helpers
// =============================================================================

type TextAutoResizeName = "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT";

function textAutoResizeEnum(name: TextAutoResizeName): { value: number; name: TextAutoResizeName } {
  return { value: TEXT_AUTO_RESIZE_VALUES[name], name };
}

type TextAlignHName = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

function textAlignHEnum(name: TextAlignHName): { value: number; name: TextAlignHName } {
  return { value: TEXT_ALIGN_H_VALUES[name], name };
}

type TextAlignVName = "TOP" | "CENTER" | "BOTTOM";

function textAlignVEnum(name: TextAlignVName): { value: number; name: TextAlignVName } {
  return { value: TEXT_ALIGN_V_VALUES[name], name };
}

type NumberUnitsName = "RAW" | "PIXELS" | "PERCENT";

function numberUnitsEnum(name: NumberUnitsName): { value: number; name: NumberUnitsName } {
  return { value: NUMBER_UNITS_VALUES[name], name };
}

function pickNextLineHeight<T>(
  needsPercent: boolean,
  spec: { value: number; units: NumberUnitsName } | undefined,
  fallback: T,
): T | { value: number; units: { value: number; name: NumberUnitsName } } {
  if (needsPercent && spec) {
    return { value: spec.value, units: numberUnitsEnum(spec.units) };
  }
  return fallback;
}

function pickNextAutoResize<T>(
  needsAutoResize: boolean,
  spec: TextAutoResizeName | undefined,
  fallback: T,
): T | { value: number; name: TextAutoResizeName } {
  if (needsAutoResize && spec) return textAutoResizeEnum(spec);
  return fallback;
}

type TextSpec = {
  readonly name?: string;
  readonly text: string;
  readonly font?: { family: string; style: string };
  readonly fontSize: number;
  readonly color: FigColor;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alignH?: TextAlignHName;
  readonly alignV?: TextAlignVName;
  readonly autoResize?: TextAutoResizeName;
  /**
   * Line height: `{ value, units }` where units is one of the
   * `NumberUnits` names. Omit to fall back to Figma's default leading.
   */
  readonly lineHeight?: { value: number; units: NumberUnitsName };
};

function addText(ctx: BuildContext, parentId: FigNodeId, spec: TextSpec): {
  readonly doc: FigDesignDocument;
  readonly nodeId: FigNodeId;
} {
  const family = spec.font?.family ?? "Inter";
  const style = spec.font?.style ?? "Regular";
  const result = add({
    ctx,
    parentId,
    spec: {
      type: "TEXT",
      name: spec.name ?? spec.text,
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
      characters: spec.text,
      fontFamily: family,
      fontStyle: style,
      fontSize: spec.fontSize,
      fills: [solidPaint(spec.color)],
      textAlignHorizontal: spec.alignH ? textAlignHEnum(spec.alignH) : undefined,
      textAlignVertical: spec.alignV ? textAlignVEnum(spec.alignV) : undefined,
      // NodeSpec.lineHeight is a plain pixel number; the factory wraps it
      // with PIXELS units. For PERCENT (or absent) we patch the node below.
      lineHeight: spec.lineHeight?.units === "PIXELS" ? spec.lineHeight.value : undefined,
    },
  });

  // textAutoResize and PERCENT-unit line height are not surfaced through
  // NodeSpec; project them onto textData via a follow-up updateNode call.
  const needsAutoResize = spec.autoResize !== undefined;
  const needsPercentLineHeight = spec.lineHeight?.units === "PERCENT" || spec.lineHeight?.units === "RAW";
  if (!needsAutoResize && !needsPercentLineHeight) {
    return { doc: result.doc, nodeId: result.nodeId };
  }
  const patchedDoc = updateNode({
    doc: result.doc,
    pageId: ctx.pageId,
    nodeId: result.nodeId,
    updater: (node) => {
      const td = node.textData;
      if (!td) {
        return node;
      }
      const nextLineHeight = pickNextLineHeight(needsPercentLineHeight, spec.lineHeight, td.lineHeight);
      const nextAutoResize = pickNextAutoResize(needsAutoResize, spec.autoResize, td.textAutoResize);
      return {
        ...node,
        textData: {
          ...td,
          textAutoResize: nextAutoResize,
          lineHeight: nextLineHeight,
        },
      };
    },
  });
  return { doc: patchedDoc, nodeId: result.nodeId };
}

// =============================================================================
// Auto-layout Helpers
// =============================================================================

type AutoLayoutInput = {
  readonly mode: "HORIZONTAL" | "VERTICAL";
  readonly gap?: number;
  readonly padding?: number | { top: number; right: number; bottom: number; left: number };
  readonly primaryAlign?: "MIN" | "CENTER" | "MAX" | "SPACE_EVENLY" | "SPACE_BETWEEN";
  readonly counterAlign?: "MIN" | "CENTER" | "MAX" | "BASELINE";
};

function expandPadding(
  padding: AutoLayoutInput["padding"],
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (typeof padding === "number") {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return padding;
}

function buildPrimaryAlignItems(
  name: AutoLayoutInput["primaryAlign"],
): { value: number; name: NonNullable<AutoLayoutInput["primaryAlign"]> } | undefined {
  if (!name) return undefined;
  return { value: STACK_JUSTIFY_VALUES[name], name };
}

function buildCounterAlignItems(
  name: AutoLayoutInput["counterAlign"],
): { value: number; name: NonNullable<AutoLayoutInput["counterAlign"]> } | undefined {
  if (!name) return undefined;
  return { value: STACK_ALIGN_VALUES[name], name };
}

function buildAutoLayout(input: AutoLayoutInput): NonNullable<Extract<NodeSpec, { type: "FRAME" | "SYMBOL" }>["autoLayout"]> {
  return {
    stackMode: { value: STACK_MODE_VALUES[input.mode], name: input.mode },
    stackSpacing: input.gap,
    stackPadding: expandPadding(input.padding),
    stackPrimaryAlignItems: buildPrimaryAlignItems(input.primaryAlign),
    stackCounterAlignItems: buildCounterAlignItems(input.counterAlign),
  };
}

// =============================================================================
// Page 1: Shapes & Fills
// =============================================================================

function buildShapesPage(ctx: BuildContext): FigDesignDocument {
  // --- Artboard: Basic Shapes ---
  const shapesFrame = add({
    ctx,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Basic Shapes",
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const c1 = withDoc(ctx, shapesFrame.doc);

  // Title
  const title = addText(c1, shapesFrame.nodeId, {
    name: "title",
    text: "Basic Shapes",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 200,
    height: 28,
  });
  const c2 = withDoc(c1, title.doc);

  // Rectangle (rounded)
  const rect = add({
    ctx: c2,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Rectangle",
      x: 24,
      y: 68,
      width: 80,
      height: 80,
      fills: [solidPaint(BLUE)],
      cornerRadius: 8,
    },
  });
  const c3 = withDoc(c2, rect.doc);

  // Ellipse
  const ellipse = add({
    ctx: c3,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "ELLIPSE",
      name: "Ellipse",
      x: 128,
      y: 68,
      width: 80,
      height: 80,
      fills: [solidPaint(RED)],
    },
  });
  const c4 = withDoc(c3, ellipse.doc);

  // Star
  const star = add({
    ctx: c4,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "STAR",
      name: "Star",
      x: 232,
      y: 68,
      width: 80,
      height: 80,
      fills: [solidPaint(ORANGE)],
    },
  });
  const c5 = withDoc(c4, star.doc);

  // Polygon (hexagon — 6 sides)
  const polygon = add({
    ctx: c5,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "REGULAR_POLYGON",
      name: "Hexagon",
      x: 336,
      y: 68,
      width: 80,
      height: 80,
      fills: [solidPaint(GREEN)],
      pointCount: 6,
    },
  });
  const c6 = withDoc(c5, polygon.doc);

  // Stroked shapes row
  const strokesSubtitle = addText(c6, shapesFrame.nodeId, {
    name: "subtitle-strokes",
    text: "Strokes",
    font: { family: "Inter", style: "Medium" },
    fontSize: 14,
    color: GRAY,
    x: 24,
    y: 170,
    width: 100,
    height: 20,
  });
  const c7 = withDoc(c6, strokesSubtitle.doc);

  // Dashed rectangle — no fill, dashed stroke. NodeSpec doesn't carry
  // strokeDashes so we patch it on after addNode.
  const dashedRect = add({
    ctx: c7,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Dashed Rect",
      x: 24,
      y: 200,
      width: 80,
      height: 80,
      fills: [],
      strokes: [solidPaint(BLUE)],
      strokeWeight: 2,
      cornerRadius: 4,
    },
  });
  const dashedRectPatched = patchNode(withDoc(c7, dashedRect.doc), dashedRect.nodeId, (node) => ({
    ...node,
    strokeDashes: [8, 4],
  }));
  const c8 = withDoc(c7, dashedRectPatched);

  // Stroke circle — outline only
  const strokeCircle = add({
    ctx: c8,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "ELLIPSE",
      name: "Stroke Circle",
      x: 128,
      y: 200,
      width: 80,
      height: 80,
      fills: [],
      strokes: [solidPaint(RED)],
      strokeWeight: 3,
    },
  });
  const c9 = withDoc(c8, strokeCircle.doc);

  // Line — round cap (NodeSpec lacks strokeCap so patch it on).
  const line = add({
    ctx: c9,
    parentId: shapesFrame.nodeId,
    spec: {
      type: "LINE",
      name: "Line",
      x: 232,
      y: 240,
      width: 80,
      height: 0,
      strokes: [solidPaint(DARK)],
      strokeWeight: 2,
    },
  });
  const lineWithCap = patchNode(withDoc(c9, line.doc), line.nodeId, (node) => ({
    ...node,
    strokeCap: "ROUND",
  }));
  const c10 = withDoc(c9, lineWithCap);

  // --- Artboard: Gradient Fills ---
  const gradFrame = add({
    ctx: c10,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Gradients",
      x: 520,
      y: 0,
      width: 480,
      height: 200,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const c11 = withDoc(c10, gradFrame.doc);

  const gradTitle = addText(c11, gradFrame.nodeId, {
    name: "title",
    text: "Gradient Fills",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 200,
    height: 28,
  });
  const c12 = withDoc(c11, gradTitle.doc);

  // Linear gradient rect
  const linearGrad = linearGradientPaint(135, [
    { color: BLUE, position: 0 },
    { color: PURPLE, position: 1 },
  ]);
  const linearRect = add({
    ctx: c12,
    parentId: gradFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Linear Gradient",
      x: 24,
      y: 68,
      width: 120,
      height: 80,
      fills: [linearGrad],
      cornerRadius: 12,
    },
  });
  const c13 = withDoc(c12, linearRect.doc);

  // Radial gradient ellipse
  const radialGrad = radialGradientPaint([
    { color: ORANGE, position: 0 },
    { color: RED, position: 1 },
  ]);
  const radialEllipse = add({
    ctx: c13,
    parentId: gradFrame.nodeId,
    spec: {
      type: "ELLIPSE",
      name: "Radial Gradient",
      x: 168,
      y: 58,
      width: 100,
      height: 100,
      fills: [radialGrad],
    },
  });
  const c14 = withDoc(c13, radialEllipse.doc);

  // Multi-stop linear gradient
  const multiGrad = linearGradientPaint(90, [
    { color: RED, position: 0 },
    { color: ORANGE, position: 0.33 },
    { color: GREEN, position: 0.66 },
    { color: BLUE, position: 1 },
  ]);
  const multiRect = add({
    ctx: c14,
    parentId: gradFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Multi-stop",
      x: 296,
      y: 68,
      width: 140,
      height: 80,
      fills: [multiGrad],
      cornerRadius: 12,
    },
  });

  return multiRect.doc;
}

// =============================================================================
// Page 2: Typography
// =============================================================================

function buildTypographyPage(ctx: BuildContext): FigDesignDocument {
  // --- Artboard: Text Alignment ---
  const alignFrame = add({
    ctx,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Text Alignment",
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const c1 = withDoc(ctx, alignFrame.doc);

  const title = addText(c1, alignFrame.nodeId, {
    name: "title",
    text: "Text Alignment",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 200,
    height: 28,
  });
  const c2 = withDoc(c1, title.doc);

  // Three horizontal-alignment samples
  const leftAlign = addText(c2, alignFrame.nodeId, {
    name: "left-align",
    text: "Left aligned text\nwith two lines",
    fontSize: 14,
    color: DARK,
    x: 24,
    y: 68,
    width: 180,
    height: 44,
    alignH: "LEFT",
    alignV: "TOP",
    autoResize: "NONE",
  });
  const c3 = withDoc(c2, leftAlign.doc);

  const centerAlign = addText(c3, alignFrame.nodeId, {
    name: "center-align",
    text: "Center aligned text\nwith two lines",
    fontSize: 14,
    color: DARK,
    x: 24,
    y: 128,
    width: 180,
    height: 44,
    alignH: "CENTER",
    alignV: "TOP",
    autoResize: "NONE",
  });
  const c4 = withDoc(c3, centerAlign.doc);

  const rightAlign = addText(c4, alignFrame.nodeId, {
    name: "right-align",
    text: "Right aligned text\nwith two lines",
    fontSize: 14,
    color: DARK,
    x: 24,
    y: 188,
    width: 180,
    height: 44,
    alignH: "RIGHT",
    alignV: "TOP",
    autoResize: "NONE",
  });
  const c5 = withDoc(c4, rightAlign.doc);

  // Vertical alignment row — light-gray bg + text overlay for each
  const vtopBg = add({
    ctx: c5,
    parentId: alignFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "vtop-bg",
      x: 260,
      y: 20,
      width: 180,
      height: 80,
      fills: [solidPaint(LIGHT_GRAY)],
      cornerRadius: 8,
    },
  });
  const c6 = withDoc(c5, vtopBg.doc);
  const vtopText = addText(c6, alignFrame.nodeId, {
    name: "vtop-text",
    text: "Vertical top\nalignment",
    fontSize: 14,
    color: DARK,
    x: 260,
    y: 20,
    width: 180,
    height: 80,
    alignH: "CENTER",
    alignV: "TOP",
    autoResize: "NONE",
  });
  const c7 = withDoc(c6, vtopText.doc);

  const vcenterBg = add({
    ctx: c7,
    parentId: alignFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "vcenter-bg",
      x: 260,
      y: 116,
      width: 180,
      height: 80,
      fills: [solidPaint(LIGHT_GRAY)],
      cornerRadius: 8,
    },
  });
  const c8 = withDoc(c7, vcenterBg.doc);
  const vcenterText = addText(c8, alignFrame.nodeId, {
    name: "vcenter-text",
    text: "Vertical center\nalignment",
    fontSize: 14,
    color: DARK,
    x: 260,
    y: 116,
    width: 180,
    height: 80,
    alignH: "CENTER",
    alignV: "CENTER",
    autoResize: "NONE",
  });
  const c9 = withDoc(c8, vcenterText.doc);

  const vbottomBg = add({
    ctx: c9,
    parentId: alignFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "vbottom-bg",
      x: 260,
      y: 212,
      width: 180,
      height: 80,
      fills: [solidPaint(LIGHT_GRAY)],
      cornerRadius: 8,
    },
  });
  const c10 = withDoc(c9, vbottomBg.doc);
  const vbottomText = addText(c10, alignFrame.nodeId, {
    name: "vbottom-text",
    text: "Vertical bottom\nalignment",
    fontSize: 14,
    color: DARK,
    x: 260,
    y: 212,
    width: 180,
    height: 80,
    alignH: "CENTER",
    alignV: "BOTTOM",
    autoResize: "NONE",
  });
  const c11 = withDoc(c10, vbottomText.doc);

  // --- Artboard: Font Styles ---
  const fontFrame = add({
    ctx: c11,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Font Styles",
      x: 520,
      y: 0,
      width: 480,
      height: 360,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const c12 = withDoc(c11, fontFrame.doc);

  const fontTitle = addText(c12, fontFrame.nodeId, {
    name: "title",
    text: "Font Styles & Sizes",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 240,
    height: 28,
  });
  const c13 = withDoc(c12, fontTitle.doc);

  const sizes = [
    { label: "Heading 1", size: 32, weight: "Bold" as const },
    { label: "Heading 2", size: 24, weight: "SemiBold" as const },
    { label: "Heading 3", size: 18, weight: "Medium" as const },
    { label: "Body text — Regular weight, comfortable for reading", size: 14, weight: "Regular" as const },
    { label: "Caption — Smaller text for labels and annotations", size: 12, weight: "Regular" as const },
  ];

  const rowTop = (index: number): number =>
    64 + sizes.slice(0, index).reduce((sum, entry) => sum + entry.size + 20, 0);

  const c14 = sizes.reduce<BuildContext>((acc, entry, index) => {
    const result = addText(acc, fontFrame.nodeId, {
      name: entry.label,
      text: entry.label,
      font: { family: "Inter", style: entry.weight },
      fontSize: entry.size,
      color: DARK,
      x: 24,
      y: rowTop(index),
      width: 440,
      height: entry.size + 12,
    });
    return withDoc(acc, result.doc);
  }, c13);

  const paragraphY = rowTop(sizes.length) + 8;

  // Multi-line paragraph: 150% PERCENT line height + HEIGHT autoresize.
  const paragraph = addText(c14, fontFrame.nodeId, {
    name: "paragraph",
    text:
      "This is a longer paragraph of text that demonstrates how multi-line " +
      "text wrapping works in Figma files. The text box has a fixed width " +
      "and the content flows naturally within the bounds.",
    fontSize: 13,
    color: GRAY,
    x: 24,
    y: paragraphY,
    width: 440,
    height: 60,
    alignH: "LEFT",
    autoResize: "HEIGHT",
    lineHeight: { value: 150, units: "PERCENT" },
  });

  return paragraph.doc;
}

// =============================================================================
// Page 3: Components & Effects
// =============================================================================

function buildComponentsPage(ctx: BuildContext): FigDesignDocument {
  // ---- Symbol: Button Component ----
  // The SYMBOL frame's fill IS the visible button background. INSTANCE
  // overrides target the INSTANCE's own `fills`, so authoring the
  // background on the SYMBOL keeps the override path direct.
  const buttonSymbol = add({
    ctx,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "Button",
      x: 0,
      y: -120,
      width: 140,
      height: 44,
      fills: [solidPaint(BLUE)],
      autoLayout: buildAutoLayout({
        mode: "HORIZONTAL",
        gap: 8,
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        primaryAlign: "CENTER",
        counterAlign: "CENTER",
      }),
    },
  });
  // Patch the SYMBOL frame with cornerRadius (SymbolNodeSpec doesn't
  // expose it directly).
  const buttonSymbolDoc = patchNode(
    withDoc(ctx, buttonSymbol.doc),
    buttonSymbol.nodeId,
    (node) => ({ ...node, cornerRadius: 8 }),
  );
  const c1 = withDoc(ctx, buttonSymbolDoc);

  const btnLabel = addText(c1, buttonSymbol.nodeId, {
    name: "label",
    text: "Button",
    font: { family: "Inter", style: "SemiBold" },
    fontSize: 14,
    color: WHITE,
    x: 42,
    y: 12,
    width: 56,
    height: 20,
    alignH: "CENTER",
  });
  const c2 = withDoc(c1, btnLabel.doc);

  // ---- Symbol: Card Component ----
  const cardSymbol = add({
    ctx: c2,
    parentId: null,
    spec: {
      type: "SYMBOL",
      name: "Card",
      x: 200,
      y: -200,
      width: 240,
      height: 160,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
      autoLayout: buildAutoLayout({
        mode: "VERTICAL",
        gap: 8,
        padding: 16,
      }),
    },
  });
  const cardSymbolDoc = patchNode(
    withDoc(c2, cardSymbol.doc),
    cardSymbol.nodeId,
    (node) => ({ ...node, cornerRadius: 12 }),
  );
  const c3 = withDoc(c2, cardSymbolDoc);

  const cardHeading = addText(c3, cardSymbol.nodeId, {
    name: "heading",
    text: "Card Title",
    font: { family: "Inter", style: "SemiBold" },
    fontSize: 16,
    color: DARK,
    x: 16,
    y: 16,
    width: 208,
    height: 22,
  });
  const c4 = withDoc(c3, cardHeading.doc);

  const cardBody = addText(c4, cardSymbol.nodeId, {
    name: "body",
    text: "Card body text that describes the content. Can span multiple lines.",
    fontSize: 13,
    color: GRAY,
    x: 16,
    y: 46,
    width: 208,
    height: 40,
    autoResize: "HEIGHT",
    lineHeight: { value: 140, units: "PERCENT" },
  });
  const c5 = withDoc(c4, cardBody.doc);

  const accentBar = add({
    ctx: c5,
    parentId: cardSymbol.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "accent-bar",
      x: 16,
      y: 140,
      width: 208,
      height: 4,
      fills: [solidPaint(BLUE)],
      cornerRadius: 2,
    },
  });
  const c6 = withDoc(c5, accentBar.doc);

  // ---- Artboard: Component Instances ----
  const compFrame = add({
    ctx: c6,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Component Instances",
      x: 0,
      y: 0,
      width: 560,
      height: 360,
      fills: [solidPaint(LIGHT_GRAY)],
      clipsContent: true,
    },
  });
  const c7 = withDoc(c6, compFrame.doc);

  const compTitle = addText(c7, compFrame.nodeId, {
    name: "title",
    text: "Component Instances",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 280,
    height: 28,
  });
  const c8 = withDoc(c7, compTitle.doc);

  const btnLabelText = addText(c8, compFrame.nodeId, {
    name: "btn-label",
    text: "Button variants",
    font: { family: "Inter", style: "Medium" },
    fontSize: 12,
    color: GRAY,
    x: 24,
    y: 64,
    width: 120,
    height: 16,
  });
  const c9 = withDoc(c8, btnLabelText.doc);

  // Default button — INSTANCE with no fill override; renders with the
  // SYMBOL's blue background.
  const btnDefault = add({
    ctx: c9,
    parentId: compFrame.nodeId,
    spec: {
      type: "INSTANCE",
      symbolId: buttonSymbol.nodeId,
      name: "Default",
      x: 24,
      y: 88,
      width: 140,
      height: 44,
    },
  });
  const c10 = withDoc(c9, btnDefault.doc);

  // Danger button — overrides the SYMBOL's background to RED. The
  // spec test (instance-resolve.spec.ts) reads `danger.fills[0]` and
  // expects it to be the red solid paint, so set fills on the
  // INSTANCE itself.
  const btnDanger = add({
    ctx: c10,
    parentId: compFrame.nodeId,
    spec: {
      type: "INSTANCE",
      symbolId: buttonSymbol.nodeId,
      name: "Danger",
      x: 184,
      y: 88,
      width: 140,
      height: 44,
      fills: [solidPaint(RED)],
    },
  });
  const c11 = withDoc(c10, btnDanger.doc);

  // Success button — green override
  const btnSuccess = add({
    ctx: c11,
    parentId: compFrame.nodeId,
    spec: {
      type: "INSTANCE",
      symbolId: buttonSymbol.nodeId,
      name: "Success",
      x: 344,
      y: 88,
      width: 140,
      height: 44,
      fills: [solidPaint(GREEN)],
    },
  });
  const c12 = withDoc(c11, btnSuccess.doc);

  const cardLabelText = addText(c12, compFrame.nodeId, {
    name: "card-label",
    text: "Card instances",
    font: { family: "Inter", style: "Medium" },
    fontSize: 12,
    color: GRAY,
    x: 24,
    y: 152,
    width: 120,
    height: 16,
  });
  const c13 = withDoc(c12, cardLabelText.doc);

  const card1 = add({
    ctx: c13,
    parentId: compFrame.nodeId,
    spec: {
      type: "INSTANCE",
      symbolId: cardSymbol.nodeId,
      name: "Card 1",
      x: 24,
      y: 176,
      width: 240,
      height: 160,
    },
  });
  const c14 = withDoc(c13, card1.doc);

  const card2 = add({
    ctx: c14,
    parentId: compFrame.nodeId,
    spec: {
      type: "INSTANCE",
      symbolId: cardSymbol.nodeId,
      name: "Card 2",
      x: 288,
      y: 176,
      width: 240,
      height: 160,
      fills: [solidPaint({ r: 0.95, g: 0.97, b: 1.0, a: 1 })],
    },
  });
  const c15 = withDoc(c14, card2.doc);

  // ---- Artboard: Effects ----
  const effectFrame = add({
    ctx: c15,
    parentId: null,
    spec: {
      type: "FRAME",
      name: "Effects",
      x: 600,
      y: 0,
      width: 560,
      height: 300,
      fills: [solidPaint(WHITE)],
      clipsContent: true,
    },
  });
  const c16 = withDoc(c15, effectFrame.doc);

  const effectsTitle = addText(c16, effectFrame.nodeId, {
    name: "title",
    text: "Effects",
    font: { family: "Inter", style: "Bold" },
    fontSize: 20,
    color: DARK,
    x: 24,
    y: 20,
    width: 200,
    height: 28,
  });
  const c17 = withDoc(c16, effectsTitle.doc);

  // Drop shadow card
  const dropShadowCard = add({
    ctx: c17,
    parentId: effectFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Drop Shadow",
      x: 24,
      y: 72,
      width: 120,
      height: 80,
      fills: [solidPaint(WHITE)],
      cornerRadius: 12,
      effects: [
        dropShadowEffect({
          offset: { x: 0, y: 4 },
          radius: 12,
          color: { r: 0, g: 0, b: 0, a: 0.15 },
        }),
      ],
    },
  });
  const c18 = withDoc(c17, dropShadowCard.doc);
  const dropShadowLabel = addText(c18, effectFrame.nodeId, {
    name: "shadow-label",
    text: "Drop Shadow",
    fontSize: 11,
    color: GRAY,
    x: 24,
    y: 160,
    width: 120,
    height: 16,
    alignH: "CENTER",
  });
  const c19 = withDoc(c18, dropShadowLabel.doc);

  // Inner shadow card
  const innerShadowCard = add({
    ctx: c19,
    parentId: effectFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Inner Shadow",
      x: 168,
      y: 72,
      width: 120,
      height: 80,
      fills: [solidPaint(LIGHT_GRAY)],
      cornerRadius: 12,
      effects: [
        innerShadowEffect({
          offset: { x: 0, y: 4 },
          radius: 8,
          color: { r: 0, g: 0, b: 0, a: 0.2 },
        }),
      ],
    },
  });
  const c20 = withDoc(c19, innerShadowCard.doc);
  const innerShadowLabel = addText(c20, effectFrame.nodeId, {
    name: "inner-label",
    text: "Inner Shadow",
    fontSize: 11,
    color: GRAY,
    x: 168,
    y: 160,
    width: 120,
    height: 16,
    alignH: "CENTER",
  });
  const c21 = withDoc(c20, innerShadowLabel.doc);

  // Layer blur card
  const layerBlurCard = add({
    ctx: c21,
    parentId: effectFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Layer Blur",
      x: 312,
      y: 72,
      width: 120,
      height: 80,
      fills: [solidPaint(BLUE)],
      cornerRadius: 12,
      effects: [layerBlurEffect(4)],
    },
  });
  const c22 = withDoc(c21, layerBlurCard.doc);
  const layerBlurLabel = addText(c22, effectFrame.nodeId, {
    name: "blur-label",
    text: "Layer Blur",
    fontSize: 11,
    color: GRAY,
    x: 312,
    y: 160,
    width: 120,
    height: 16,
    alignH: "CENTER",
  });
  const c23 = withDoc(c22, layerBlurLabel.doc);

  // Multi-shadow stack
  const multiShadowCard = add({
    ctx: c23,
    parentId: effectFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Multi Shadow",
      x: 24,
      y: 200,
      width: 120,
      height: 80,
      fills: [solidPaint(WHITE)],
      cornerRadius: 12,
      effects: [
        dropShadowEffect({ offset: { x: 0, y: 1 }, radius: 3, color: { r: 0, g: 0, b: 0, a: 0.08 } }),
        dropShadowEffect({ offset: { x: 0, y: 4 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.08 } }),
        dropShadowEffect({ offset: { x: 0, y: 12 }, radius: 24, color: { r: 0, g: 0, b: 0, a: 0.12 } }),
      ],
    },
  });
  const c24 = withDoc(c23, multiShadowCard.doc);
  const multiShadowLabel = addText(c24, effectFrame.nodeId, {
    name: "multi-label",
    text: "Multi Shadow",
    fontSize: 11,
    color: GRAY,
    x: 24,
    y: 288,
    width: 120,
    height: 16,
    alignH: "CENTER",
  });
  const c25 = withDoc(c24, multiShadowLabel.doc);

  // Colored shadow on gradient-filled card
  const colorShadowGrad = linearGradientPaint(135, [
    { color: PURPLE, position: 0 },
    { color: BLUE, position: 1 },
  ]);
  const coloredShadowCard = add({
    ctx: c25,
    parentId: effectFrame.nodeId,
    spec: {
      type: "ROUNDED_RECTANGLE",
      name: "Colored Shadow",
      x: 168,
      y: 200,
      width: 120,
      height: 80,
      fills: [colorShadowGrad],
      cornerRadius: 12,
      effects: [
        dropShadowEffect({
          offset: { x: 0, y: 8 },
          radius: 20,
          color: { ...PURPLE, a: 0.4 },
        }),
      ],
    },
  });
  const c26 = withDoc(c25, coloredShadowCard.doc);
  const coloredShadowLabel = addText(c26, effectFrame.nodeId, {
    name: "color-shadow-label",
    text: "Colored Shadow",
    fontSize: 11,
    color: GRAY,
    x: 168,
    y: 288,
    width: 120,
    height: 16,
    alignH: "CENTER",
  });

  return coloredShadowLabel.doc;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a demo FigDesignDocument with rich content.
 *
 * Builds the document directly via the canonical builder helpers —
 * no fig-file binary round-trip. The function still returns a
 * `Promise<FigDesignDocument>` so callers (specs and consumers) can
 * keep awaiting it without churn.
 *
 * Pages:
 * 1. Shapes & Fills — basic shapes, strokes, gradients
 * 2. Typography — alignment, sizes, multi-line, paragraph
 * 3. Components & Effects — symbol/instance, shadows, blur
 * 4. Internal Only Canvas — Figma importer requirement
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function createDemoFigDesignDocument(): Promise<FigDesignDocument> {
  const initialDoc = createEmptyFigDesignDocument("Shapes & Fills");
  const state = createFigBuilderState({
    nodeIdCounter: { sessionID: 1, nextLocalID: 10 },
    pageIdCounter: { sessionID: 0, nextLocalID: 2 },
  });
  const shapesPageId = initialDoc.pages[0]!.id;

  const docAfterShapes = buildShapesPage({ state, doc: initialDoc, pageId: shapesPageId });

  const typographyPageResult = addPage({ state, doc: docAfterShapes, name: "Typography" });
  const docAfterTypography = buildTypographyPage({
    state,
    doc: typographyPageResult.doc,
    pageId: typographyPageResult.pageId,
  });

  const componentsPageResult = addPage({ state, doc: docAfterTypography, name: "Components & Effects" });
  const docAfterComponents = buildComponentsPage({
    state,
    doc: componentsPageResult.doc,
    pageId: componentsPageResult.pageId,
  });

  // Figma's importer expects an Internal Only Canvas page even when it
  // hosts no proxy nodes.
  const finalDoc = addPage({
    state,
    doc: docAfterComponents,
    name: "Internal Only Canvas",
    internalOnly: true,
  }).doc;

  return finalDoc;
}
