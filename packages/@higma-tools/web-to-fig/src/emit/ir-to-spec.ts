/**
 * @file IR node → document-io NodeSpec.
 *
 * The two sides:
 *   - IR carries CSS-flavoured paint / effect / blend / auto-layout
 *     vocabulary.
 *   - NodeSpec carries Figma's normalised vocabulary
 *     (`FigPaint`, `FigEffect`, `AutoLayoutProps`, ...).
 *
 * The bridge adapters (`@higma-bridges/web-fig/adapters`) handle the
 * leaf conversions; this module composes them into a complete
 * `NodeSpec` graph and tracks the `parent → children` topology so the
 * caller can drive `addNode`.
 */
import type {
  AutoLayoutIR,
  NodeIR,
  StrokeIR,
} from "@higma-bridges/web-fig";
import {
  irAutoLayoutToFig,
  irEffectToFig,
  irPaintToFig,
  resolveCornerRadius,
} from "@higma-bridges/web-fig";
import type { FigPaint, KiwiEnumValue } from "@higma-document-models/fig/types";
import { fontQueryToStyleName, normalizeWeight } from "@higma-document-models/fig/font";
import {
  TEXT_ALIGN_H_VALUES,
  TEXT_ALIGN_V_VALUES,
  type TextAlignHorizontal,
  type TextAlignVertical,
} from "@higma-document-models/fig/constants";
import type { TextStyleIR } from "@higma-bridges/web-fig";
import { splitSubpaths } from "./split-subpaths";
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
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
    clipsContent: node.style.clipsContent,
    autoLayout: irAutoLayoutToFigOrUndefined(node.autoLayout),
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
  if (resolved.every((r) => r === resolved[0])) {
    if (resolved[0] === 0) {
      return undefined;
    }
    return { uniform: resolved[0] };
  }
  return { perCorner: resolved };
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
      weight: normalizeWeight(node.textStyle.fontWeight),
      style: node.textStyle.fontStyle,
    }),
    lineHeight: irLineHeightToPx(node.textStyle.lineHeight),
    textAlignHorizontal: textAlignHToFig(node.textStyle.textAlign),
    textAlignVertical: textAlignVToFig(node.textStyle.textAlignVertical),
  };
}

/**
 * Translate the IR's CSS `text-align` value (`left` / `center` / ...) into
 * Figma's TextAlignHorizontal enum value. Returns undefined for the
 * default `left` so the spec stays terse for the dominant case (Figma's
 * fallback is also LEFT). Anything else is encoded explicitly.
 */
function textAlignHToFig(
  value: TextStyleIR["textAlign"],
): KiwiEnumValue<TextAlignHorizontal> | undefined {
  if (value === "left") {
    return undefined;
  }
  switch (value) {
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
 * `bottom`) into Figma's TextAlignVertical enum value. Returns
 * undefined for the default `top` so the spec stays terse — Figma's
 * fallback is also TOP. Used when the captured element's flex /
 * grid container expressed cross-axis centring around its single
 * text child (see normaliser's `textAlignVerticalFromCss`).
 */
function textAlignVToFig(
  value: TextStyleIR["textAlignVertical"],
): KiwiEnumValue<TextAlignVertical> | undefined {
  if (value === "top") {
    return undefined;
  }
  switch (value) {
    case "center":
      return { value: TEXT_ALIGN_V_VALUES.CENTER, name: "CENTER" };
    case "bottom":
      return { value: TEXT_ALIGN_V_VALUES.BOTTOM, name: "BOTTOM" };
  }
}

function irLineHeightToPx(lh: { readonly unit: "px"; readonly value: number } | { readonly unit: "ratio"; readonly value: number } | { readonly unit: "normal" }): number | undefined {
  if (lh.unit === "px") {
    return lh.value;
  }
  return undefined;
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
    effects: node.style.effects.map(irEffectToFig),
    opacity: node.style.opacity,
    visible: node.visible,
  };
}

function vectorSpec(node: NodeIR & { readonly kind: "vector" }): VectorNodeSpec {
  // Each captured `d` may carry multiple SVG subpaths (multi-piece
  // icons, compound silhouettes, glyph clusters). Splitting on every
  // `M` / `m` boundary turns those into independent `vectorPath`
  // entries — Figma resets its pen position between entries, so
  // subpaths that should render as separate strokes / silhouettes
  // never get connected by a stray fill or stroke.
  const vectorPaths = node.paths.flatMap((p) =>
    splitSubpaths(p.d).map((segment) => ({
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

function irAutoLayoutToFigOrUndefined(layout: AutoLayoutIR): FrameNodeSpec["autoLayout"] {
  return irAutoLayoutToFig(layout);
}

function strokeToFig(stroke: StrokeIR): FigPaint {
  return irPaintToFig(stroke.paint);
}

function maxStrokeWeight(strokes: readonly StrokeIR[]): number | undefined {
  if (strokes.length === 0) {
    return undefined;
  }
  return strokes.reduce((acc, s) => (s.weight > acc ? s.weight : acc), 0);
}

