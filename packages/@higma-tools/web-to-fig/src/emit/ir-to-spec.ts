/**
 * @file IR node → document-io NodeSpec.
 */
import type {
  NodeIR,
  StrokeIR,
} from "@higma-bridges/web-fig";
import {
  irAutoLayoutToFig,
  irEffectToFig,
  irPaintToFig,
  resolveCornerRadius,
} from "@higma-bridges/web-fig";
import type { FigPaint, FigStrokeAlign, KiwiEnumValue } from "@higma-document-models/fig/types";
import { fontQueryToStyleName, snapFontWeight } from "@higma-document-models/fig/font";
import {
  STROKE_ALIGN_VALUES,
  TEXT_ALIGN_H_VALUES,
  TEXT_ALIGN_V_VALUES,
  type TextAlignHorizontal,
  type TextAlignVertical,
} from "@higma-document-models/fig/constants";
import type { TextStyleIR } from "@higma-bridges/web-fig";
import { splitSubpathsRespectingFillRule } from "./split-subpaths";
import type {
  FrameNodeSpec,
  NodeSpec,
  RectNodeSpec,
  RoundedRectNodeSpec,
  TextNodeSpec,
  VectorNodeSpec,
} from "@higma-document-io/fig/types";

export type SpecGraph = {
  readonly spec: NodeSpec;
  readonly children: readonly SpecGraph[];
};

/** Convert one IR node into a SpecGraph (NodeSpec + child SpecGraphs). */
export function irToSpecGraph(node: NodeIR): SpecGraph {
  switch (node.kind) {
    case "frame":
      return {
        spec: frameSpec(node),
        children: node.children.map(irToSpecGraph),
      };
    case "text":
      return { spec: textSpec(node), children: [] };
    case "rectangle":
      return { spec: rectangleSpec(node), children: [] };
    case "vector":
      return { spec: vectorSpec(node), children: [] };
  }
}

function frameSpec(node: NodeIR & { readonly kind: "frame" }): FrameNodeSpec {
  const radii = resolveFrameCornerRadii(node);
  return {
    type: "FRAME",
    name: node.name,
    x: node.box.x,
    y: node.box.y,
    width: node.box.width,
    height: node.box.height,
    fills: node.style.fills.map(irPaintToFig),
    strokes: node.style.strokes.map(strokeToFig),
    strokeWeight: maxStrokeWeight(node.style.strokes),
    strokeAlign: strokeAlignToFig(node.style.strokes),
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
    clipsContent: node.style.clipsContent,
    ...irAutoLayoutToFig(node.autoLayout),
    cornerRadius: radii?.uniform,
    rectangleCornerRadii: radii?.perCorner,
  };
}

/**
 * Translate the IR's per-corner `LengthIR` quartet onto the FRAME spec's
 * two-field corner-radius surface. Figma stores a single `cornerRadius`
 * when every corner is uniform, and a `rectangleCornerRadii` quartet
 * otherwise — keeping both around lets the renderer pick the cheaper
 * uniform path while still supporting authored asymmetric corners
 * (`border-top-left-radius: 8px` only). Returns undefined when the IR
 * has no radii at all (the common case for a structural `<div>`).
 */
function resolveFrameCornerRadii(
  node: NodeIR & { readonly kind: "frame" },
): { readonly uniform?: number; readonly perCorner?: readonly [number, number, number, number] } | undefined {
  const radii = node.style.cornerRadius;
  if (!radii) {
    return undefined;
  }
  const resolved: readonly [number, number, number, number] = [
    resolveCornerRadius(radii[0], node.box),
    resolveCornerRadius(radii[1], node.box),
    resolveCornerRadius(radii[2], node.box),
    resolveCornerRadius(radii[3], node.box),
  ];
  if (!resolved.every((r) => r === resolved[0])) {
    return { perCorner: resolved };
  }
  if (resolved[0] === 0) {
    return undefined;
  }
  return { uniform: resolved[0] };
}

function textSpec(node: NodeIR & { readonly kind: "text" }): TextNodeSpec {
  return {
    type: "TEXT",
    name: node.name,
    x: node.box.x,
    y: node.box.y,
    width: node.box.width,
    height: node.box.height,
    fills: node.style.fills.map(irPaintToFig),
    strokes: node.style.strokes.map(strokeToFig),
    strokeWeight: maxStrokeWeight(node.style.strokes),
    strokeAlign: strokeAlignToFig(node.style.strokes),
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
    characters: node.characters,
    fontSize: node.textStyle.fontSize,
    fontFamily: node.textStyle.fontFamily,
    // SoT: combine numeric weight + style into the canonical Figma
    // `fontName.style` label via `fontQueryToStyleName`. The previous
    // implementation only looked at the italic/oblique flag and dropped
    // `fontWeight` entirely, which silently turned every Bold web style
    // into a "Regular" Figma label.
    fontStyle: fontQueryToStyleName({
      family: node.textStyle.fontFamily,
      weight: snapFontWeight(node.textStyle.fontWeight),
      style: node.textStyle.fontStyle,
    }),
    lineHeight: irLineHeightToPx(node.textStyle.lineHeight, node.textStyle.fontSize),
    // Browser-resolved CSS `letter-spacing` arrives in IR as a numeric
    // CSS-pixel value. It is emitted explicitly so TEXT creation never
    // relies on a reader-side default.
    letterSpacing: node.textStyle.letterSpacing,
    textAlignHorizontal: textAlignHToFig(node.textStyle.textAlign),
    textAlignVertical: textAlignVToFig(node.textStyle.textAlignVertical),
  };
}

/**
 * Translate the IR's CSS `text-align` value (`left` / `center` / ...) into
 * Figma's TextAlignHorizontal enum value.
 */
function textAlignHToFig(
  value: TextStyleIR["textAlign"],
): KiwiEnumValue<TextAlignHorizontal> {
  switch (value) {
    case "left":
      return { value: TEXT_ALIGN_H_VALUES.LEFT, name: "LEFT" };
    case "center":
      return { value: TEXT_ALIGN_H_VALUES.CENTER, name: "CENTER" };
    case "right":
      return { value: TEXT_ALIGN_H_VALUES.RIGHT, name: "RIGHT" };
    case "justify":
      return { value: TEXT_ALIGN_H_VALUES.JUSTIFIED, name: "JUSTIFIED" };
  }
}

/**
 * Translate the IR's vertical text alignment (`top` / `center` /
 * `bottom`) into Figma's TextAlignVertical enum value.
 */
function textAlignVToFig(
  value: TextStyleIR["textAlignVertical"],
): KiwiEnumValue<TextAlignVertical> {
  switch (value) {
    case "top":
      return { value: TEXT_ALIGN_V_VALUES.TOP, name: "TOP" };
    case "center":
      return { value: TEXT_ALIGN_V_VALUES.CENTER, name: "CENTER" };
    case "bottom":
      return { value: TEXT_ALIGN_V_VALUES.BOTTOM, name: "BOTTOM" };
  }
}

function irLineHeightToPx(
  lh: { readonly unit: "px"; readonly value: number } | { readonly unit: "ratio"; readonly value: number } | { readonly unit: "normal" },
  fontSize: number,
): number {
  if (lh.unit === "px") {
    return lh.value;
  }
  if (lh.unit === "ratio") {
    return lh.value * fontSize;
  }
  throw new Error("irToSpecGraph: TEXT lineHeight=normal must be resolved before Fig emission");
}

function rectangleSpec(node: NodeIR & { readonly kind: "rectangle" }): RectNodeSpec | RoundedRectNodeSpec {
  const radii = node.style.cornerRadius;
  if (radii) {
    const resolved: readonly [number, number, number, number] = [
      resolveCornerRadius(radii[0], node.box),
      resolveCornerRadius(radii[1], node.box),
      resolveCornerRadius(radii[2], node.box),
      resolveCornerRadius(radii[3], node.box),
    ];
    return {
      type: "ROUNDED_RECTANGLE",
      name: node.name,
      x: node.box.x,
      y: node.box.y,
      width: node.box.width,
      height: node.box.height,
      fills: node.style.fills.map(irPaintToFig),
      strokes: node.style.strokes.map(strokeToFig),
      strokeWeight: maxStrokeWeight(node.style.strokes),
      strokeAlign: strokeAlignToFig(node.style.strokes),
      effects: node.style.effects.map(irEffectToFig),
      opacity: node.style.opacity,
      visible: node.visible,
      rectangleCornerRadii: resolved,
    };
  }
  return {
    type: "RECTANGLE",
    name: node.name,
    x: node.box.x,
    y: node.box.y,
    width: node.box.width,
    height: node.box.height,
    fills: node.style.fills.map(irPaintToFig),
    strokes: node.style.strokes.map(strokeToFig),
    strokeWeight: maxStrokeWeight(node.style.strokes),
    strokeAlign: strokeAlignToFig(node.style.strokes),
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
  };
}

function vectorSpec(node: NodeIR & { readonly kind: "vector" }): VectorNodeSpec {
  // SVG `fill-rule: evenodd` is *cross-subpath* — a donut icon
  // (outer circle + inner circle in one `d`) draws a hole because
  // even-odd winding cancels overlapping subpaths together. Splitting
  // such a path into independent `vectorPath` entries forces Figma to
  // evaluate winding per-entry and the inner subpath becomes a second
  // disk on top of the outer one. So we only split when the path
  // uses nonzero winding (or has no fill-rule), where each subpath
  // is independently filled and the only reason to split is to stop
  // Figma drawing a stray join between an open subpath's pen
  // position and the next subpath's `M`.
  const vectorPaths = node.paths.flatMap((p) =>
    splitSubpathsRespectingFillRule(p.d, p.fillRule).map((segment) => ({
      windingRule: (p.fillRule === "evenodd" ? "EVENODD" : "NONZERO") as "EVENODD" | "NONZERO",
      data: segment,
    })),
  );
  return {
    type: "VECTOR",
    name: node.name,
    x: node.box.x,
    y: node.box.y,
    width: node.box.width,
    height: node.box.height,
    fills: node.style.fills.map(irPaintToFig),
    strokes: node.style.strokes.map(strokeToFig),
    strokeWeight: maxStrokeWeight(node.style.strokes),
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
    vectorPaths,
  };
}

function strokeToFig(stroke: StrokeIR): FigPaint {
  return irPaintToFig(stroke.paint);
}

function strokeAlignToFig(strokes: readonly StrokeIR[]): KiwiEnumValue<FigStrokeAlign> | undefined {
  if (strokes.length === 0) {
    return undefined;
  }
  const first = strokes[0]!.align;
  for (const stroke of strokes) {
    if (stroke.align !== first) {
      throw new Error("irToSpecGraph: multiple stroke alignments cannot be collapsed into one Kiwi strokeAlign");
    }
  }
  switch (first) {
    case "inside":
      return { value: STROKE_ALIGN_VALUES.INSIDE, name: "INSIDE" };
    case "outside":
      return { value: STROKE_ALIGN_VALUES.OUTSIDE, name: "OUTSIDE" };
    case "center":
      return { value: STROKE_ALIGN_VALUES.CENTER, name: "CENTER" };
  }
}

function maxStrokeWeight(strokes: readonly StrokeIR[]): number | undefined {
  if (strokes.length === 0) {
    return undefined;
  }
  return strokes.reduce((acc, s) => (s.weight > acc ? s.weight : acc), 0);
}
