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
import type { FigPaint } from "@higma-document-models/fig/types";
import { fontQueryToStyleName, normalizeWeight } from "@higma-document-models/fig/font";
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
  };
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
  };
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
    vectorPaths: node.paths.map((p) => ({
      windingRule: p.fillRule === "evenodd" ? "EVENODD" : "NONZERO",
      data: p.d,
    })),
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

