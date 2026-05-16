/** @file Adapter between FigPaint and kernel PaintItemView. */

import { figColorToHex, hexToFigColor } from "@higma-document-models/fig/color";
import type {
  FigColor,
  FigGradientPaint,
  FigGradientStop,
  FigPaint,
  FigPaintType,
  FigVector,
} from "@higma-document-models/fig/types";
import type {
  GradientHandleView,
  GradientStopView,
  ImageScaleModeId,
  PaintItemView,
  PaintTypeId,
} from "@higma-editor-kernel/ui/property-sections";

const PAINT_TYPES = new Set<FigPaintType>([
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
]);

function toPaintType(type: FigPaintType): PaintTypeId {
  if (!PAINT_TYPES.has(type)) {
    throw new Error(`Unsupported fig paint type for view adapter: ${type}`);
  }
  return type as PaintTypeId;
}

function toImageScaleMode(value: string | undefined): ImageScaleModeId {
  if (value === "FILL" || value === "FIT" || value === "CROP" || value === "TILE") {
    return value;
  }
  return "FILL";
}

function toColorHex(color: FigColor | undefined): string {
  if (!color) {
    return "#000000";
  }
  return figColorToHex(color);
}

function getPaintColor(paint: FigPaint): FigColor | undefined {
  if ("color" in paint && paint.color) {
    return paint.color;
  }
  return undefined;
}

function getPaintOpacity(paint: FigPaint): number {
  if ("opacity" in paint && typeof paint.opacity === "number") {
    return paint.opacity;
  }
  return 1;
}

function isGradientPaint(paint: FigPaint): paint is FigGradientPaint {
  return paint.type.startsWith("GRADIENT_");
}

export function normalizeGradientStops(paint: FigGradientPaint): readonly FigGradientStop[] {
  const stops = paint.gradientStops ?? paint.stops;
  if (stops && stops.length > 0) {
    return [...stops].sort((a, b) => a.position - b.position);
  }
  return [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
  ];
}

export function normalizeGradientHandles(paint: FigGradientPaint): readonly FigVector[] {
  if (paint.gradientHandlePositions && paint.gradientHandlePositions.length >= 3) {
    return paint.gradientHandlePositions;
  }
  return [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
  ];
}

function toGradientStopViews(paint: FigGradientPaint): readonly GradientStopView[] {
  return normalizeGradientStops(paint).map((stop) => ({
    position: stop.position,
    hex: figColorToHex(stop.color),
    alpha: stop.color.a,
  }));
}

function toGradientHandleViews(paint: FigGradientPaint): readonly GradientHandleView[] {
  return normalizeGradientHandles(paint).map((handle) => ({ x: handle.x, y: handle.y }));
}

/** Convert a FigPaint into the kernel view model used by the paint section views. */
export function figPaintToView(paint: FigPaint): PaintItemView {
  const opacity = getPaintOpacity(paint);
  const hex = toColorHex(getPaintColor(paint));
  const type = toPaintType(paint.type);

  if (isGradientPaint(paint)) {
    return {
      type,
      hex,
      opacity,
      gradient: {
        stops: toGradientStopViews(paint),
        handles: toGradientHandleViews(paint),
      },
    };
  }

  if (paint.type === "IMAGE") {
    return {
      type,
      hex,
      opacity,
      image: {
        imageRef: paint.imageRef ?? "",
        scaleMode: toImageScaleMode(paint.scaleMode ?? paint.imageScaleMode),
        scale: paint.scalingFactor ?? paint.scale ?? 1,
        rotationDeg: ((paint.rotation ?? 0) * 180) / Math.PI,
      },
    };
  }

  return { type, hex, opacity };
}

function withSortedStops(paint: FigGradientPaint, stops: readonly FigGradientStop[]): FigGradientPaint {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  return { ...paint, gradientStops: sorted, stops: sorted };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolateStopColor(stops: readonly FigGradientStop[], position: number): FigColor {
  const previous = [...stops].reverse().find((stop) => stop.position <= position) ?? stops[0]!;
  const next = stops.find((stop) => stop.position >= position) ?? stops[stops.length - 1]!;
  const range = next.position - previous.position;
  const t = range === 0 ? 0 : (position - previous.position) / range;
  return {
    r: previous.color.r + (next.color.r - previous.color.r) * t,
    g: previous.color.g + (next.color.g - previous.color.g) * t,
    b: previous.color.b + (next.color.b - previous.color.b) * t,
    a: previous.color.a + (next.color.a - previous.color.a) * t,
  };
}

function findLargestStopGapMidpoint(stops: readonly FigGradientStop[]): number {
  const first = stops[0]?.position ?? 0;
  const last = stops[stops.length - 1]?.position ?? 1;
  const initial = { bestStart: first, bestEnd: last, bestGap: last - first };
  const { bestStart, bestEnd } = stops.slice(1).reduce((best, current, index) => {
    const previous = stops[index]!;
    const gap = current.position - previous.position;
    if (gap <= best.bestGap) {
      return best;
    }
    return { bestStart: previous.position, bestEnd: current.position, bestGap: gap };
  }, initial);
  return clamp01((bestStart + bestEnd) / 2);
}

export function updateGradientStop(paint: FigPaint, stopIndex: number, stop: GradientStopView): FigPaint {
  if (!isGradientPaint(paint)) {
    return paint;
  }
  const current = normalizeGradientStops(paint);
  const next = current.map((existing, index) => {
    if (index !== stopIndex) {
      return existing;
    }
    return {
      position: stop.position,
      color: hexToFigColor(stop.hex, stop.alpha),
    } satisfies FigGradientStop;
  });
  return withSortedStops(paint, next);
}

export function addGradientStop(paint: FigPaint): FigPaint {
  if (!isGradientPaint(paint)) {
    return paint;
  }
  const stops = normalizeGradientStops(paint);
  const position = findLargestStopGapMidpoint(stops);
  const color = interpolateStopColor(stops, position);
  return withSortedStops(paint, [...stops, { position, color }]);
}

export function removeGradientStop(paint: FigPaint, stopIndex: number): FigPaint {
  if (!isGradientPaint(paint)) {
    return paint;
  }
  const stops = normalizeGradientStops(paint);
  if (stops.length <= 2) {
    return paint;
  }
  return withSortedStops(paint, stops.filter((_, index) => index !== stopIndex));
}

export function updateGradientHandle(paint: FigPaint, handleIndex: number, handle: GradientHandleView): FigPaint {
  if (!isGradientPaint(paint)) {
    return paint;
  }
  const handles = normalizeGradientHandles(paint).map((existing, index) => index === handleIndex ? handle : existing);
  return { ...paint, gradientHandlePositions: handles };
}
