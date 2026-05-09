/**
 * @file FigDesignNode → NodeIR (read side).
 *
 * Used by web-to-fig's round-trip spec to compare an emitted
 * FigDesignDocument against the IR that produced it. The mapping is
 * the structural inverse of `irToSpecGraph` in
 * `@higma-tools/web-to-fig` plus the leaf adapters in this package.
 *
 * Coverage matches the IR vocabulary: FRAME / RECTANGLE /
 * ROUNDED_RECTANGLE / TEXT / VECTOR. Anything else throws — the IR
 * has no slot to receive it.
 *
 * Boxes: FigDesignNode stores position in `transform.m02 / m12`
 * (a 2x3 affine), but the IR's `box.x / .y` is the parent-local
 * top-left position. We project the translation directly because the
 * IR doesn't carry rotation/skew — these are out of scope for the
 * bridge.
 */
import type {
  AutoLayoutIR,
  ChildSizingIR,
  EffectIR,
  FrameNodeIR,
  NodeIR,
  PaintIR,
  RectNodeIR,
  StrokeIR,
  StyleIR,
  TextNodeIR,
  TextStyleIR,
  VectorNodeIR,
} from "../ir/types";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import type { FigPaint, FigStrokeWeight } from "@higma-document-models/fig/types";
import { figPaintToIR } from "./paint";
import { figEffectToIR } from "./effect";
import { figBlendModeToIR } from "./blend-mode";
import { figAutoLayoutToIR } from "./auto-layout";

/** Convert a FigDesignNode (read-side) into the bridge IR. */
export function figNodeToIR(node: FigDesignNode): NodeIR {
  switch (node.type) {
    case "FRAME":
    case "COMPONENT":
    case "GROUP":
    case "SECTION":
      return frameToIR(node);
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
    case "ELLIPSE":
      return rectToIR(node);
    case "TEXT":
      return textToIR(node);
    case "VECTOR":
    case "LINE":
    case "STAR":
    case "REGULAR_POLYGON":
      return vectorToIR(node);
    default:
      throw new Error(`figNodeToIR: node type "${node.type}" is not part of the bridge IR`);
  }
}

function frameToIR(node: FigDesignNode): FrameNodeIR {
  const children = (node.children ?? []).map(figNodeToIR);
  return {
    kind: "frame",
    id: node.id,
    componentKey: node.id,
    name: node.name,
    box: boxFromNode(node),
    style: styleFromNode(node),
    visible: node.visible,
    sizing: sizingPlaceholder(),
    autoLayout: autoLayoutFromNode(node),
    children,
  };
}

function rectToIR(node: FigDesignNode): RectNodeIR {
  return {
    kind: "rectangle",
    id: node.id,
    componentKey: node.id,
    name: node.name,
    box: boxFromNode(node),
    style: styleFromNode(node),
    visible: node.visible,
    sizing: sizingPlaceholder(),
  };
}

function textToIR(node: FigDesignNode): TextNodeIR {
  const td = node.textData;
  if (!td) {
    throw new Error(`figNodeToIR: TEXT node ${node.id} missing textData`);
  }
  return {
    kind: "text",
    id: node.id,
    componentKey: node.id,
    name: node.name,
    box: boxFromNode(node),
    style: styleFromNode(node),
    visible: node.visible,
    sizing: sizingPlaceholder(),
    characters: td.characters,
    textStyle: textStyleFromTextData(td),
  };
}

function vectorToIR(node: FigDesignNode): VectorNodeIR {
  const path = node.vectorPaths?.[0]?.data ?? "";
  return {
    kind: "vector",
    id: node.id,
    componentKey: node.id,
    name: node.name,
    box: boxFromNode(node),
    style: styleFromNode(node),
    visible: node.visible,
    sizing: sizingPlaceholder(),
    path,
  };
}

function boxFromNode(node: FigDesignNode): NodeIR["box"] {
  return {
    x: node.transform.m02,
    y: node.transform.m12,
    width: node.size.x,
    height: node.size.y,
  };
}

function sizingPlaceholder(): ChildSizingIR {
  // The fig side does not carry CSS sizing intent (hug / fill / fixed)
  // because Figma's sizing lives on the parent's auto-layout. Round-trip
  // tooling only inspects `sizing` when comparing an IR back to itself
  // through web-to-fig; the fig→IR direction never sees it. Default to
  // absolute so callers do not get a false-positive flow sizing.
  return { mode: "absolute" };
}

function styleFromNode(node: FigDesignNode): StyleIR {
  const fills = (node.fills ?? []).map(figPaintToIRSafe).filter((p): p is PaintIR => p !== undefined);
  const strokes = strokesFromNode(node);
  const effects = (node.effects ?? []).map<EffectIR>(figEffectToIR);
  return {
    fills,
    strokes,
    effects,
    opacity: node.opacity,
    cornerRadius: cornerRadiiFromNode(node),
    clipsContent: node.clipsContent === true,
    blendMode: figBlendModeToIR(node.blendMode),
  };
}

function strokesFromNode(node: FigDesignNode): readonly StrokeIR[] {
  const stroke = node.strokes?.[0];
  if (!stroke) {
    return [];
  }
  const weight = strokeWeightToScalar(node.strokeWeight);
  if (weight === undefined || weight <= 0) {
    return [];
  }
  return [{
    paint: figPaintToIR(stroke as FigPaint),
    weight,
    align: strokeAlignToIR(node.strokeAlign),
    dashes: node.strokeDashes,
  }];
}

function strokeWeightToScalar(weight: FigStrokeWeight | undefined): number | undefined {
  if (weight === undefined) {
    return undefined;
  }
  if (typeof weight === "number") {
    return weight;
  }
  return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

function strokeAlignToIR(align: FigDesignNode["strokeAlign"]): StrokeIR["align"] {
  switch (align) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    case "CENTER":
    case undefined:
      return "center";
  }
}

function cornerRadiiFromNode(node: FigDesignNode): StyleIR["cornerRadius"] {
  if (node.rectangleCornerRadii && node.rectangleCornerRadii.length === 4) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    return [tl ?? 0, tr ?? 0, br ?? 0, bl ?? 0];
  }
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    const r = node.cornerRadius;
    return [r, r, r, r];
  }
  return undefined;
}

function autoLayoutFromNode(node: FigDesignNode): AutoLayoutIR {
  return figAutoLayoutToIR(node.autoLayout);
}

function textStyleFromTextData(td: NonNullable<FigDesignNode["textData"]>): TextStyleIR {
  const fontFamily = td.fontName.family;
  const styleName = td.fontName.style;
  return {
    fontFamily,
    fontStyle: fontStyleFromStyleName(styleName),
    fontWeight: weightFromStyleName(styleName),
    fontSize: td.fontSize,
    lineHeight: lineHeightFromTextData(td),
    letterSpacing: td.letterSpacing?.value ?? 0,
    textAlign: textAlignFromName(td.textAlignHorizontal?.name),
    textTransform: textCaseFromName(td.textCase?.name),
    textDecoration: textDecorationFromName(td.textDecoration?.name),
  };
}

function fontStyleFromStyleName(styleName: string): TextStyleIR["fontStyle"] {
  const lower = styleName.toLowerCase();
  if (lower.includes("italic")) {
    return "italic";
  }
  if (lower.includes("oblique")) {
    return "oblique";
  }
  return "normal";
}

function lineHeightFromTextData(td: NonNullable<FigDesignNode["textData"]>): TextStyleIR["lineHeight"] {
  if (!td.lineHeight) {
    return { unit: "normal" };
  }
  if (td.lineHeight.units?.name === "PIXELS") {
    return { unit: "px", value: td.lineHeight.value };
  }
  return { unit: "normal" };
}

function weightFromStyleName(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("thin") || lower.includes("hairline")) {
    return 100;
  }
  if (lower.includes("extralight") || lower.includes("ultra light")) {
    return 200;
  }
  if (lower.includes("light")) {
    return 300;
  }
  if (lower.includes("regular") || lower === "italic" || lower === "oblique") {
    return 400;
  }
  if (lower.includes("medium")) {
    return 500;
  }
  if (lower.includes("semibold") || lower.includes("demibold")) {
    return 600;
  }
  if (lower.includes("bold")) {
    return 700;
  }
  if (lower.includes("extrabold") || lower.includes("ultrabold")) {
    return 800;
  }
  if (lower.includes("black") || lower.includes("heavy")) {
    return 900;
  }
  return 400;
}

function textAlignFromName(name: string | undefined): TextStyleIR["textAlign"] {
  switch (name) {
    case "RIGHT":
      return "right";
    case "CENTER":
      return "center";
    case "JUSTIFIED":
      return "justify";
    case "LEFT":
    case undefined:
      return "left";
    default:
      throw new Error(`figNodeToIR: unknown textAlignHorizontal "${name}"`);
  }
}

function textCaseFromName(name: string | undefined): TextStyleIR["textTransform"] {
  switch (name) {
    case "UPPER":
      return "uppercase";
    case "LOWER":
      return "lowercase";
    case "TITLE":
      return "capitalize";
    case "ORIGINAL":
    case undefined:
      return "none";
    default:
      return "none";
  }
}

function textDecorationFromName(name: string | undefined): TextStyleIR["textDecoration"] {
  switch (name) {
    case "UNDERLINE":
      return "underline";
    case "STRIKETHROUGH":
      return "line-through";
    case "NONE":
    case undefined:
      return "none";
    default:
      return "none";
  }
}

/**
 * Wrap `figPaintToIR` to skip paints whose type is outside the bridge
 * vocabulary. The reverse adapter is consulted in round-trip
 * comparisons, where unrecognised paints would otherwise blow up the
 * whole document. Paint types we *did* support but that have a known
 * loss (e.g. radial gradients we don't yet model) are still
 * representable as solids — but we'd rather drop them than silently
 * approximate. The dedicated round-trip spec asserts the supported
 * subset is closed.
 */
function figPaintToIRSafe(paint: FigPaint): PaintIR | undefined {
  switch (paint.type) {
    case "SOLID":
    case "GRADIENT_LINEAR":
    case "IMAGE":
      return figPaintToIR(paint);
    default:
      return undefined;
  }
}
