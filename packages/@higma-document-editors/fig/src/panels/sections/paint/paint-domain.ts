/** @file Paint operations over Kiwi paint arrays. */
import { asGradientPaint, asImagePaint, asSolidPaint, getPaintType } from "@higma-document-models/fig/color";
import { figImageHashHexToBytes } from "@higma-document-models/fig/domain";
import {
  BLEND_MODE_VALUES,
  PAINT_TYPE_VALUES,
  SCALE_MODE_VALUES,
  STROKE_ALIGN_VALUES,
  STROKE_CAP_VALUES,
  STROKE_JOIN_VALUES,
  canonicaliseImageScaleMode,
  kiwiEnumName,
  toEnumValue,
  type EnumValue,
} from "@higma-document-models/fig/constants";
import type {
  BlendMode,
  FigColor,
  FigGradientPaint,
  FigGradientStop,
  FigGradientTransform,
  FigImagePaint,
  FigImageScaleMode,
  FigNode,
  FigPaint,
  FigSolidPaint,
} from "@higma-document-models/fig/types";
import { getGradientDirectionFromTransform, getGradientStops, getImageHash, getScaleMode } from "@higma-document-renderers/fig/paint";
import type {
  GradientHandleView,
  GradientStopView,
  ImageScaleModeId,
  PaintItemView,
  PaintTypeId,
} from "@higma-editor-kernel/ui/property-sections";

export type PaintListKind = "fill" | "stroke";

const EDITOR_AUTHORED_BLACK: FigColor = { r: 0, g: 0, b: 0, a: 1 };
const EDITOR_AUTHORED_WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };
const EDITOR_AUTHORED_LINEAR_TRANSFORM: FigGradientTransform = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: -0.5,
};

const PAINT_TYPES = new Set<PaintTypeId>([
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
]);

function requirePaintType(name: string): PaintTypeId {
  if (PAINT_TYPES.has(name as PaintTypeId)) {
    return name as PaintTypeId;
  }
  throw new Error(`Paint editor does not support Kiwi paint type ${name}`);
}

function componentToHex(value: number): string {
  const byte = Math.round(Math.max(0, Math.min(1, value)) * 255);
  return byte.toString(16).padStart(2, "0");
}

/** Convert a Fig color to a CSS hex color. */
export function figColorToHex(color: FigColor): string {
  return `#${componentToHex(color.r)}${componentToHex(color.g)}${componentToHex(color.b)}`;
}

/** Convert a CSS hex color to a Fig color while preserving alpha. */
export function hexToFigColor(hex: string, alpha: number): FigColor {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`hexToFigColor requires #rrggbb, got ${hex}`);
  }
  const value = match[1]!;
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
    a: alpha,
  };
}

/** Require the first solid paint for the currently editable paint list. */
export function firstSolidPaint(paints: readonly FigPaint[] | undefined): FigSolidPaint | undefined {
  return paints?.map(asSolidPaint).find((paint) => paint !== undefined);
}

/** Create a Kiwi solid paint payload for editor-authored paint edits. */
export function solidPaint(color: FigColor, current: FigSolidPaint | undefined): FigSolidPaint {
  return {
    type: { value: PAINT_TYPE_VALUES.SOLID, name: "SOLID" },
    color,
    opacity: current?.opacity ?? 1,
    visible: current?.visible ?? true,
  };
}

/** Read the selected Kiwi paint list from a node. */
export function paintList(node: FigNode, kind: PaintListKind): readonly FigPaint[] {
  if (kind === "fill") {
    return node.fillPaints ?? [];
  }
  return node.strokePaints ?? [];
}

/** Write the selected Kiwi paint list onto a node. */
export function writePaintList(node: FigNode, kind: PaintListKind, paints: readonly FigPaint[]): FigNode {
  if (kind === "fill") {
    return { ...node, fillPaints: paints };
  }
  return { ...node, strokePaints: paints };
}

function paintOpacity(paint: FigPaint): number {
  return paint.opacity ?? 1;
}

function paintColor(paint: FigPaint): FigColor {
  const solid = asSolidPaint(paint);
  if (solid !== undefined) {
    return solid.color;
  }
  const gradient = asGradientPaint(paint);
  if (gradient === undefined) {
    return EDITOR_AUTHORED_BLACK;
  }
  const first = getGradientStops(gradient)[0];
  if (first === undefined) {
    throw new Error("Gradient paint requires a first stop color");
  }
  return first.color;
}

function kiwiPaintType<T extends PaintTypeId>(type: T): EnumValue<T> {
  const value = PAINT_TYPE_VALUES[type];
  if (typeof value !== "number") {
    throw new Error(`Paint type ${type} is not present in the Kiwi schema`);
  }
  return { value, name: type };
}

function kiwiImageScaleMode(scaleMode: ImageScaleModeId): EnumValue<FigImageScaleMode> {
  const mode = canonicaliseImageScaleMode(scaleMode);
  const value = toEnumValue(mode, SCALE_MODE_VALUES);
  if (value === undefined) {
    throw new Error(`Image scale mode ${scaleMode} is not present in the Kiwi schema`);
  }
  return value;
}

function kiwiBlendMode(blendMode: BlendMode): EnumValue<BlendMode> {
  const value = toEnumValue(blendMode, BLEND_MODE_VALUES);
  if (value === undefined) {
    throw new Error(`Blend mode ${blendMode} is not present in the Kiwi schema`);
  }
  return value;
}

function authoredGradientStops(color: FigColor): readonly FigGradientStop[] {
  return [
    { position: 0, color },
    { position: 1, color: EDITOR_AUTHORED_WHITE },
  ];
}

function gradientHandles(paint: FigGradientPaint): readonly GradientHandleView[] {
  const type = getPaintType(paint);
  if (type === "GRADIENT_LINEAR") {
    const direction = getGradientDirectionFromTransform(paint.transform);
    return [
      direction.start,
      direction.end,
      { x: direction.start.x, y: direction.end.y },
    ];
  }
  const transform = paint.transform;
  if (transform === undefined) {
    throw new Error(`${type} paint requires transform before editing gradient handles`);
  }
  const m00 = transform.m00 ?? 1;
  const m01 = transform.m01 ?? 0;
  const m02 = transform.m02 ?? 0;
  const m10 = transform.m10 ?? 0;
  const m11 = transform.m11 ?? 1;
  const m12 = transform.m12 ?? 0;
  return [
    { x: m02, y: m12 },
    { x: m02 + m00, y: m12 + m10 },
    { x: m02 + m01, y: m12 + m11 },
  ];
}

function stopsToView(stops: readonly FigGradientStop[]): readonly GradientStopView[] {
  return stops.map((stop) => ({
    position: stop.position,
    hex: figColorToHex(stop.color),
    alpha: stop.color.a,
  }));
}

function imageScaleModeToView(paint: FigImagePaint): ImageScaleModeId {
  const scaleMode = getScaleMode(paint);
  if (scaleMode === "STRETCH") {
    return "FILL";
  }
  return scaleMode;
}

/** Convert a Kiwi paint into the property-section view state. */
export function paintToView(paint: FigPaint): PaintItemView {
  const type = requirePaintType(getPaintType(paint));
  const color = paintColor(paint);
  const gradient = asGradientPaint(paint);
  if (type.startsWith("GRADIENT_") && gradient !== undefined) {
    return {
      type,
      hex: figColorToHex(color),
      opacity: paintOpacity(paint),
      gradient: {
        stops: stopsToView(getGradientStops(gradient)),
        handles: gradientHandles(gradient),
      },
    };
  }
  if (type.startsWith("GRADIENT_")) {
    throw new Error(`Paint ${type} is not a Kiwi gradient paint`);
  }
  const image = asImagePaint(paint);
  if (type === "IMAGE" && image !== undefined) {
    return {
      type,
      hex: figColorToHex(color),
      opacity: paintOpacity(paint),
      image: {
        imageHashHex: getImageHash(image),
        scaleMode: imageScaleModeToView(image),
        scale: image.scale ?? 1,
        rotationDeg: ((image.rotation ?? 0) * 180) / Math.PI,
      },
    };
  }
  if (type === "IMAGE") {
    throw new Error("IMAGE paint is not a Kiwi image paint");
  }
  return { type, hex: figColorToHex(color), opacity: paintOpacity(paint) };
}

function writeGradientStops(paint: FigGradientPaint, stops: readonly FigGradientStop[]): FigGradientPaint {
  return {
    ...paint,
    stops: [...stops].sort((left, right) => left.position - right.position),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolateColor(left: FigColor, right: FigColor, t: number): FigColor {
  return {
    r: left.r + (right.r - left.r) * t,
    g: left.g + (right.g - left.g) * t,
    b: left.b + (right.b - left.b) * t,
    a: left.a + (right.a - left.a) * t,
  };
}

function largestStopGapMidpoint(stops: readonly FigGradientStop[]): number {
  const sorted = [...stops].sort((left, right) => left.position - right.position);
  if (sorted.length < 2) {
    throw new Error("Adding a gradient stop requires at least two existing stops");
  }
  const seed = {
    start: sorted[0]!.position,
    end: sorted[1]!.position,
    gap: sorted[1]!.position - sorted[0]!.position,
  };
  const best = sorted.slice(2).reduce((current, stop, index) => {
    const previous = sorted[index + 1]!;
    const gap = stop.position - previous.position;
    if (gap <= current.gap) {
      return current;
    }
    return { start: previous.position, end: stop.position, gap };
  }, seed);
  return clamp01((best.start + best.end) / 2);
}

function colorAtPosition(stops: readonly FigGradientStop[], position: number): FigColor {
  const sorted = [...stops].sort((left, right) => left.position - right.position);
  const before = [...sorted].reverse().find((stop) => stop.position <= position);
  const after = sorted.find((stop) => stop.position >= position);
  if (before === undefined || after === undefined) {
    throw new Error(`Gradient stop position ${position} is outside the authored stop range`);
  }
  const span = after.position - before.position;
  if (span === 0) {
    return before.color;
  }
  return interpolateColor(before.color, after.color, (position - before.position) / span);
}

function transformFromHandles(handles: readonly GradientHandleView[]): FigGradientTransform {
  const start = handles[0];
  const end = handles[1];
  if (start === undefined || end === undefined) {
    throw new Error("Linear gradient editing requires start and end handles");
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    throw new Error("Linear gradient start and end handles must not overlap");
  }
  return {
    m00: dx / lengthSquared,
    m01: dy / lengthSquared,
    m02: -((start.x * dx + start.y * dy) / lengthSquared),
    m10: -dy / lengthSquared,
    m11: dx / lengthSquared,
    m12: -((start.x * -dy + start.y * dx) / lengthSquared),
  };
}

function affineFromHandles(handles: readonly GradientHandleView[]): FigGradientTransform {
  const origin = handles[0];
  const axisX = handles[1];
  const axisY = handles[2];
  if (origin === undefined || axisX === undefined || axisY === undefined) {
    throw new Error("Gradient editing requires three handles");
  }
  return {
    m00: axisX.x - origin.x,
    m01: axisY.x - origin.x,
    m02: origin.x,
    m10: axisX.y - origin.y,
    m11: axisY.y - origin.y,
    m12: origin.y,
  };
}

function updateGradientPaint(paint: FigPaint, updater: (paint: FigGradientPaint) => FigGradientPaint): FigPaint {
  const gradient = asGradientPaint(paint);
  if (gradient === undefined) {
    throw new Error(`Paint ${getPaintType(paint)} is not editable as a gradient`);
  }
  return updater(gradient);
}

function updateImagePaint(paint: FigPaint, updater: (paint: FigImagePaint) => FigImagePaint): FigPaint {
  const image = asImagePaint(paint);
  if (image === undefined) {
    throw new Error(`Paint ${getPaintType(paint)} is not editable as an image`);
  }
  return updater(image);
}

/** Replace one paint in a Kiwi paint list. */
export function replacePaint(paints: readonly FigPaint[], index: number, updater: (paint: FigPaint) => FigPaint): readonly FigPaint[] {
  const paint = paints[index];
  if (paint === undefined) {
    throw new Error(`Paint index ${index} is outside the paint list`);
  }
  return paints.map((current, currentIndex) => {
    if (currentIndex === index) {
      return updater(current);
    }
    return current;
  });
}

/** Append an editor-authored solid paint. */
export function addPaint(paints: readonly FigPaint[]): readonly FigPaint[] {
  return [
    ...paints,
    solidPaint(EDITOR_AUTHORED_BLACK, undefined),
  ];
}

/** Remove one paint from a Kiwi paint list. */
export function removePaint(paints: readonly FigPaint[], index: number): readonly FigPaint[] {
  if (paints[index] === undefined) {
    throw new Error(`Paint index ${index} is outside the paint list`);
  }
  return paints.filter((_, currentIndex) => currentIndex !== index);
}

/** Change the Kiwi paint type while preserving fields accepted by that type. */
export function setPaintType(paint: FigPaint, type: PaintTypeId): FigPaint {
  if (type === "SOLID") {
    return solidPaint(paintColor(paint), asSolidPaint(paint));
  }
  if (type.startsWith("GRADIENT_")) {
    const gradient = asGradientPaint(paint);
    return {
      ...paint,
      type: kiwiPaintType(type),
      stops: gradient?.stops ?? authoredGradientStops(paintColor(paint)),
      transform: gradient?.transform ?? EDITOR_AUTHORED_LINEAR_TRANSFORM,
    } as FigGradientPaint;
  }
  const image = asImagePaint(paint);
  if (type === "IMAGE" && image !== undefined) {
    return { ...image, type: kiwiPaintType("IMAGE") };
  }
  if (type === "IMAGE") {
    throw new Error("Changing a non-image paint to IMAGE requires selecting an existing Kiwi image hash first");
  }
  throw new Error(`Paint editor does not support paint type ${type}`);
}

/** Set Kiwi paint opacity. */
export function setPaintOpacity(paint: FigPaint, opacity: number): FigPaint {
  return { ...paint, opacity };
}

/** Set the primary editable color for a Kiwi paint. */
export function setPaintColor(paint: FigPaint, hex: string): FigPaint {
  const solid = asSolidPaint(paint);
  if (solid !== undefined) {
    return solidPaint(hexToFigColor(hex, solid.color.a), solid);
  }
  return updateGradientPaint(paint, (gradient) => {
    const stops = getGradientStops(gradient);
    const first = stops[0];
    if (first === undefined) {
      throw new Error("Gradient paint requires a first stop before color editing");
    }
    return writeGradientStops(gradient, [
      { ...first, color: hexToFigColor(hex, first.color.a) },
      ...stops.slice(1),
    ]);
  });
}

/** Set the Kiwi image hash for an image paint. */
export function setImageHashHex(paint: FigPaint, imageHashHex: string): FigPaint {
  return updateImagePaint(paint, (image) => ({
    ...image,
    image: { hash: figImageHashHexToBytes(imageHashHex) },
  }));
}

/** Set the Kiwi image scale mode for an image paint. */
export function setImageScaleMode(paint: FigPaint, scaleMode: ImageScaleModeId): FigPaint {
  return updateImagePaint(paint, (image) => ({
    ...image,
    imageScaleMode: kiwiImageScaleMode(scaleMode),
  }));
}

/** Set the Kiwi image scale factor for an image paint. */
export function setImageScale(paint: FigPaint, scale: number): FigPaint {
  return updateImagePaint(paint, (image) => ({ ...image, scale }));
}

/** Set the Kiwi image rotation from editor degrees. */
export function setImageRotationDeg(paint: FigPaint, rotationDeg: number): FigPaint {
  return updateImagePaint(paint, (image) => ({ ...image, rotation: (rotationDeg * Math.PI) / 180 }));
}

/** Update one Kiwi gradient stop. */
export function setGradientStop(paint: FigPaint, stopIndex: number, stop: GradientStopView): FigPaint {
  return updateGradientPaint(paint, (gradient) => {
    const stops = getGradientStops(gradient);
    if (stops[stopIndex] === undefined) {
      throw new Error(`Gradient stop index ${stopIndex} is outside the stop list`);
    }
    return writeGradientStops(gradient, stops.map((current, index) => {
      if (index !== stopIndex) {
        return current;
      }
      return {
        position: stop.position,
        color: hexToFigColor(stop.hex, stop.alpha),
      };
    }));
  });
}

/** Add a Kiwi gradient stop at the largest stop gap midpoint. */
export function addGradientStop(paint: FigPaint): FigPaint {
  return updateGradientPaint(paint, (gradient) => {
    const stops = getGradientStops(gradient);
    const position = largestStopGapMidpoint(stops);
    return writeGradientStops(gradient, [
      ...stops,
      { position, color: colorAtPosition(stops, position) },
    ]);
  });
}

/** Remove one Kiwi gradient stop. */
export function removeGradientStop(paint: FigPaint, stopIndex: number): FigPaint {
  return updateGradientPaint(paint, (gradient) => {
    const stops = getGradientStops(gradient);
    if (stops.length <= 2) {
      throw new Error("Removing a gradient stop requires at least three stops");
    }
    if (stops[stopIndex] === undefined) {
      throw new Error(`Gradient stop index ${stopIndex} is outside the stop list`);
    }
    return writeGradientStops(gradient, stops.filter((_, index) => index !== stopIndex));
  });
}

/** Update one Kiwi gradient handle. */
export function setGradientHandle(paint: FigPaint, handleIndex: number, handle: GradientHandleView): FigPaint {
  return updateGradientPaint(paint, (gradient) => {
    const handles = gradientHandles(gradient);
    if (handles[handleIndex] === undefined) {
      throw new Error(`Gradient handle index ${handleIndex} is outside the handle list`);
    }
    const nextHandles = handles.map((current, index) => {
      if (index === handleIndex) {
        return handle;
      }
      return current;
    });
    const type = getPaintType(gradient);
    if (type === "GRADIENT_LINEAR") {
      return { ...gradient, transform: transformFromHandles(nextHandles) };
    }
    return { ...gradient, transform: affineFromHandles(nextHandles) };
  });
}

/** Read the Kiwi stroke alignment name. */
export function strokeAlignName(node: FigNode): "CENTER" | "INSIDE" | "OUTSIDE" {
  return kiwiEnumName<"CENTER" | "INSIDE" | "OUTSIDE">(node.strokeAlign, "strokeAlign") ?? "CENTER";
}

/** Read the Kiwi stroke cap name. */
export function strokeCapName(node: FigNode): "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL" {
  return kiwiEnumName<"NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL">(node.strokeCap, "strokeCap") ?? "NONE";
}

/** Read the Kiwi stroke join name. */
export function strokeJoinName(node: FigNode): "MITER" | "BEVEL" | "ROUND" {
  return kiwiEnumName<"MITER" | "BEVEL" | "ROUND">(node.strokeJoin, "strokeJoin") ?? "MITER";
}

/** Set the Kiwi stroke alignment. */
export function setStrokeAlign(node: FigNode, value: "CENTER" | "INSIDE" | "OUTSIDE"): FigNode {
  return { ...node, strokeAlign: toEnumValue(value, STROKE_ALIGN_VALUES) };
}

/** Set the Kiwi stroke cap. */
export function setStrokeCap(node: FigNode, value: "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL"): FigNode {
  return { ...node, strokeCap: toEnumValue(value, STROKE_CAP_VALUES) };
}

/** Set the Kiwi stroke join. */
export function setStrokeJoin(node: FigNode, value: "MITER" | "BEVEL" | "ROUND"): FigNode {
  return { ...node, strokeJoin: toEnumValue(value, STROKE_JOIN_VALUES) };
}

/** Set the Kiwi stroke dash array. */
export function setStrokeDashes(node: FigNode, value: readonly number[]): FigNode {
  return { ...node, strokeDashes: value.length > 0 ? value : undefined };
}

/** Set the Kiwi paint blend mode. */
export function setPaintBlendMode(paint: FigPaint, blendMode: BlendMode): FigPaint {
  return { ...paint, blendMode: kiwiBlendMode(blendMode) };
}
