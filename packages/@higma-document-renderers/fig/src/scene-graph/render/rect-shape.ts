/** @file Rectangle SVG primitive resolution shared by SVG backends. */

import {
  buildRoundedRectPathD,
  buildSmoothedRoundedRectPathD,
  parseSvgPathD,
  type CornerRadius,
  type PathCommand,
} from "@higma-primitives/path";

export type RectShapePrimitive =
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    }
  | {
      readonly kind: "path";
      readonly d: string;
    };

export type PathContourRectSize = {
  readonly width: number;
  readonly height: number;
};

type Point = {
  readonly x: number;
  readonly y: number;
};

type AxisAlignedRectPath = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type RoundedRectPath = AxisAlignedRectPath & {
  readonly rx: number;
};

type MoveCommand = Extract<PathCommand, { readonly type: "M" }>;
type LineCommand = Extract<PathCommand, { readonly type: "L" }>;
type CubicCommand = Extract<PathCommand, { readonly type: "C" }>;

const RECT_PATH_EPSILON = 0.02;

/**
 * Resolves a rectangle into the primitive SVG shape shared by renderers.
 */
export function resolveRectShapePrimitive(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing?: number,
): RectShapePrimitive {
  const smoothed = resolveSmoothedRectShapePrimitive(width, height, cornerRadius, cornerSmoothing);
  if (smoothed !== undefined) {
    return smoothed;
  }
  const uniform = uniformCornerRadius(cornerRadius);
  if (uniform === undefined && cornerRadius !== undefined && typeof cornerRadius !== "number") {
    return { kind: "path", d: buildRoundedRectPathD(width, height, cornerRadius) };
  }
  const rxValue = resolveUniformRectRadius(uniform, cornerRadius);
  if (rxValue <= 0) {
    return { kind: "rect", x: 0, y: 0, width, height };
  }
  return {
    kind: "rect",
    x: 0,
    y: 0,
    width,
    height,
    rx: clampSvgRectCornerRadius(width, height, rxValue),
  };
}

/**
 * Resolves the shape primitive Figma uses for stacked paint layers.
 *
 * Single-fill rounded rectangles can use SVG's native `<rect rx>`.
 * In Figma's export, however, additional paint layers on a rounded
 * rectangle are emitted as the cubic rounded-rect path. Chromium
 * rasterises `<rect rx>` and that equivalent path with different
 * edge coverage at a few pixels, so React SVG and string SVG must use
 * the path primitive for layered rounded-rect fills.
 */
export function resolveLayeredRectShapePrimitive(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing?: number,
): RectShapePrimitive {
  return resolvePathBackedRectShapePrimitive(width, height, cornerRadius, cornerSmoothing);
}

/**
 * Resolves the shape primitive Figma uses when a rounded rectangle must
 * rasterize through an SVG effect or paint stack. Native `<rect rx>` and
 * its equivalent cubic path are visually close, but not identical under
 * blur/downscale. Effect and multi-paint call sites therefore use this
 * path-backed shape as their shared SoT.
 */
export function resolvePathBackedRectShapePrimitive(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing?: number,
): RectShapePrimitive {
  const roundedPath = resolveRoundedRectPathPrimitive(width, height, cornerRadius, cornerSmoothing);
  if (roundedPath !== undefined) {
    return roundedPath;
  }
  return { kind: "rect", x: 0, y: 0, width, height };
}

/**
 * Recognizes path contours that can be emitted as SVG rect primitives.
 */
export function resolvePathContourRectPrimitive(
  contour: { readonly d: string; readonly fillRule?: "evenodd" },
  size?: PathContourRectSize,
): Extract<RectShapePrimitive, { readonly kind: "rect" }> | undefined {
  if (contour.fillRule !== undefined) {
    return undefined;
  }
  const commands = parseSvgPathD(contour.d);
  const rectPath = resolveAxisAlignedRectPath(commands);
  if (rectPath !== undefined) {
    return sizeRectPath(rectPath, size);
  }
  const roundedRectPath = resolveRoundedRectPath(commands);
  if (roundedRectPath === undefined) {
    return undefined;
  }
  return sizeRectPath(roundedRectPath, size);
}

function resolveSmoothedRectShapePrimitive(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing: number | undefined,
): Extract<RectShapePrimitive, { readonly kind: "path" }> | undefined {
  const smoothing = positiveCornerSmoothing(cornerSmoothing);
  if (smoothing === 0) {
    return undefined;
  }
  const radii = cornerRadiusToTuple(cornerRadius);
  if (radii === undefined) {
    return undefined;
  }
  return { kind: "path", d: buildSmoothedRoundedRectPathD(width, height, radii, smoothing) };
}

function resolveRoundedRectPathPrimitive(
  width: number,
  height: number,
  cornerRadius: CornerRadius | undefined,
  cornerSmoothing: number | undefined,
): Extract<RectShapePrimitive, { readonly kind: "path" }> | undefined {
  const smoothed = resolveSmoothedRectShapePrimitive(width, height, cornerRadius, cornerSmoothing);
  if (smoothed !== undefined) {
    return smoothed;
  }
  const radii = cornerRadiusToTuple(cornerRadius);
  if (radii === undefined) {
    return undefined;
  }
  return { kind: "path", d: buildRoundedRectPathD(width, height, radii) };
}

function resolveUniformRectRadius(
  uniform: number | undefined,
  cornerRadius: CornerRadius | undefined,
): number {
  if (uniform !== undefined) {
    return uniform;
  }
  if (typeof cornerRadius === "number") {
    return cornerRadius;
  }
  return 0;
}

function resolveAxisAlignedRectPath(commands: readonly PathCommand[]): AxisAlignedRectPath | undefined {
  if (!commands.every(isAxisAlignedRectPathCommand)) {
    return undefined;
  }
  const points = commands.flatMap(axisAlignedRectCommandPoint);
  const hasClose = commands.some((command) => command.type === "Z");
  const candidate = hasClose ? points : closedPointList(points);
  if (candidate === undefined) {
    return undefined;
  }
  return rectFromCornerPoints(candidate);
}

function isAxisAlignedRectPathCommand(
  command: PathCommand,
): command is Extract<PathCommand, { readonly type: "M" | "L" | "Z" }> {
  return command.type === "M" || command.type === "L" || command.type === "Z";
}

function axisAlignedRectCommandPoint(
  command: Extract<PathCommand, { readonly type: "M" | "L" | "Z" }>,
): readonly Point[] {
  if (command.type === "Z") {
    return [];
  }
  return [{ x: command.x, y: command.y }];
}

function resolveRoundedRectPath(commands: readonly PathCommand[]): RoundedRectPath | undefined {
  const topEdgeStarted = topEdgeStartedRoundedRectPath(commands);
  if (topEdgeStarted !== undefined) {
    return topEdgeStarted;
  }
  const shapeCommands = roundedRectShapeCommands(commands);
  if (shapeCommands === undefined) {
    return undefined;
  }
  const [move, topLeft, top, topRight, right, bottomRight, bottom, bottomLeft] = shapeCommands;
  const x0 = move.x;
  const y0 = top.y;
  const x1 = right.x;
  const y1 = bottom.y;
  if (x1 <= x0 || y1 <= y0) {
    return undefined;
  }
  const radii = [
    move.y - y0,
    topLeft.x - x0,
    x1 - top.x,
    topRight.y - y0,
    y1 - right.y,
    x1 - bottomRight.x,
    bottom.x - x0,
    y1 - bottomLeft.y,
  ];
  const radius = uniformPositiveRadius(radii);
  if (radius === undefined) {
    return undefined;
  }
  if (!roundedCornerCommandsMatch({ x0, y0, x1, y1, radius, topLeft, topRight, bottomRight, bottomLeft })) {
    return undefined;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: radius };
}

function roundedRectShapeCommands(
  commands: readonly PathCommand[],
): readonly [
  MoveCommand,
  CubicCommand,
  LineCommand,
  CubicCommand,
  LineCommand,
  CubicCommand,
  LineCommand,
  CubicCommand,
] | undefined {
  const withoutClose = commands[commands.length - 1]?.type === "Z" ? commands.slice(0, -1) : commands;
  const body = dropClosingLineToStart(withoutClose);
  if (body.length !== 8) {
    return undefined;
  }
  const [move, topLeft, top, topRight, right, bottomRight, bottom, bottomLeft] = body;
  if (
    move?.type !== "M" ||
    topLeft?.type !== "C" ||
    top?.type !== "L" ||
    topRight?.type !== "C" ||
    right?.type !== "L" ||
    bottomRight?.type !== "C" ||
    bottom?.type !== "L" ||
    bottomLeft?.type !== "C"
  ) {
    return undefined;
  }
  return [move, topLeft, top, topRight, right, bottomRight, bottom, bottomLeft];
}

function topEdgeStartedRoundedRectPath(commands: readonly PathCommand[]): RoundedRectPath | undefined {
  const withoutClose = commands[commands.length - 1]?.type === "Z" ? commands.slice(0, -1) : commands;
  if (withoutClose.length !== 9) {
    return undefined;
  }
  const [move, top, topRight, right, bottomRight, bottom, bottomLeft, left, topLeft] = withoutClose;
  if (
    move?.type !== "M" ||
    top?.type !== "L" ||
    topRight?.type !== "C" ||
    right?.type !== "L" ||
    bottomRight?.type !== "C" ||
    bottom?.type !== "L" ||
    bottomLeft?.type !== "C" ||
    left?.type !== "L" ||
    topLeft?.type !== "C"
  ) {
    return undefined;
  }
  if (!near(topLeft.x, move.x) || !near(topLeft.y, move.y)) {
    return undefined;
  }
  const x0 = left.x;
  const y0 = move.y;
  const x1 = topRight.x;
  const y1 = bottomRight.y;
  if (x1 <= x0 || y1 <= y0) {
    return undefined;
  }
  const radii = [
    move.x - x0,
    x1 - top.x,
    topRight.y - y0,
    y1 - right.y,
    x1 - bottomRight.x,
    bottom.x - x0,
    y1 - bottomLeft.y,
    left.y - y0,
  ];
  const radius = uniformPositiveRadius(radii);
  if (radius === undefined) {
    return undefined;
  }
  if (!roundedCornerCommandsMatch({ x0, y0, x1, y1, radius, topLeft, topRight, bottomRight, bottomLeft })) {
    return undefined;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: radius };
}

function dropClosingLineToStart(commands: readonly PathCommand[]): readonly PathCommand[] {
  const first = commands[0];
  const last = commands[commands.length - 1];
  if (first?.type !== "M" || last?.type !== "L") {
    return commands;
  }
  if (!near(first.x, last.x) || !near(first.y, last.y)) {
    return commands;
  }
  return commands.slice(0, -1);
}

function roundedCornerCommandsMatch(
  {
    x0,
    y0,
    x1,
    y1,
    radius,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  }: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
    readonly radius: number;
    readonly topLeft: Extract<PathCommand, { readonly type: "C" }>;
    readonly topRight: Extract<PathCommand, { readonly type: "C" }>;
    readonly bottomRight: Extract<PathCommand, { readonly type: "C" }>;
    readonly bottomLeft: Extract<PathCommand, { readonly type: "C" }>;
  },
): boolean {
  return (
    near(topLeft.x, x0 + radius) &&
    near(topLeft.y, y0) &&
    near(topLeft.x1, x0) &&
    between(topLeft.y1, y0, y0 + radius) &&
    between(topLeft.x2, x0, x0 + radius) &&
    near(topLeft.y2, y0) &&
    near(topRight.x, x1) &&
    near(topRight.y, y0 + radius) &&
    between(topRight.x1, x1 - radius, x1) &&
    near(topRight.y1, y0) &&
    near(topRight.x2, x1) &&
    between(topRight.y2, y0, y0 + radius) &&
    near(bottomRight.x, x1 - radius) &&
    near(bottomRight.y, y1) &&
    near(bottomRight.x1, x1) &&
    between(bottomRight.y1, y1 - radius, y1) &&
    between(bottomRight.x2, x1 - radius, x1) &&
    near(bottomRight.y2, y1) &&
    near(bottomLeft.x, x0) &&
    near(bottomLeft.y, y1 - radius) &&
    between(bottomLeft.x1, x0, x0 + radius) &&
    near(bottomLeft.y1, y1) &&
    near(bottomLeft.x2, x0) &&
    between(bottomLeft.y2, y1 - radius, y1)
  );
}

function sizeRectPath<T extends AxisAlignedRectPath>(
  rectPath: T,
  size: PathContourRectSize | undefined,
): T & { readonly kind: "rect" } {
  if (size === undefined) {
    return { ...rectPath, kind: "rect" };
  }
  if (!near(rectPath.x, 0) || !near(rectPath.y, 0)) {
    return { ...rectPath, kind: "rect" };
  }
  if (!near(rectPath.width, size.width) || !near(rectPath.height, size.height)) {
    return { ...rectPath, kind: "rect" };
  }
  return { ...rectPath, kind: "rect", width: size.width, height: size.height };
}

function rectFromCornerPoints(points: readonly Point[]): AxisAlignedRectPath | undefined {
  const xs = uniqueSortedNumbers(points.map((point) => point.x));
  const ys = uniqueSortedNumbers(points.map((point) => point.y));
  if (xs.length !== 2 || ys.length !== 2) {
    return undefined;
  }
  const [x0, x1] = xs;
  const [y0, y1] = ys;
  if (x1 <= x0 || y1 <= y0) {
    return undefined;
  }
  const corners = new Set(points.map((point) => `${point.x},${point.y}`));
  if (corners.size !== 4) {
    return undefined;
  }
  for (const point of points) {
    const onX = point.x === x0 || point.x === x1;
    const onY = point.y === y0 || point.y === y1;
    if (!onX || !onY) {
      return undefined;
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function closedPointList(points: readonly Point[]): readonly Point[] | undefined {
  if (points.length !== 5) {
    return undefined;
  }
  const first = points[0];
  const last = points[4];
  if (first === undefined || last === undefined || first.x !== last.x || first.y !== last.y) {
    return undefined;
  }
  return points.slice(0, 4);
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniformPositiveRadius(values: readonly number[]): number | undefined {
  const first = values[0];
  if (first === undefined || first <= 0) {
    return undefined;
  }
  if (!values.every((value) => near(value, first))) {
    return undefined;
  }
  return first;
}

function between(value: number, start: number, end: number): boolean {
  return value >= start - RECT_PATH_EPSILON && value <= end + RECT_PATH_EPSILON;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECT_PATH_EPSILON;
}

function clampSvgRectCornerRadius(width: number, height: number, radius: number): number {
  return Math.min(radius, width / 2, height / 2);
}

function positiveCornerSmoothing(smoothing: number | undefined): number {
  if (smoothing === undefined || smoothing <= 0) {
    return 0;
  }
  return smoothing;
}

function uniformCornerRadius(cornerRadius: CornerRadius | undefined): number | undefined {
  if (cornerRadius === undefined) {
    return undefined;
  }
  if (typeof cornerRadius === "number") {
    return cornerRadius;
  }
  const [tl, tr, br, bl] = cornerRadius;
  if (tl === tr && tr === br && br === bl) {
    return tl;
  }
  return undefined;
}

function cornerRadiusToTuple(cornerRadius: CornerRadius | undefined): readonly [number, number, number, number] | undefined {
  if (cornerRadius === undefined) {
    return undefined;
  }
  if (typeof cornerRadius === "number") {
    return positiveScalarCornerRadiusToTuple(cornerRadius);
  }
  const [tl, tr, br, bl] = cornerRadius;
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
    return undefined;
  }
  return [tl, tr, br, bl];
}

function positiveScalarCornerRadiusToTuple(radius: number): readonly [number, number, number, number] | undefined {
  if (radius <= 0) {
    return undefined;
  }
  return [radius, radius, radius, radius];
}
