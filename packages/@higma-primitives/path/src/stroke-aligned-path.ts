/**
 * @file Stroke-aligned closed path construction.
 *
 * Figma's SVG exporter cannot express `strokeAlign=OUTSIDE` on an
 * arbitrary closed SVG path. For simple closed vector contours it emits
 * the path that lies on the aligned stroke centerline, then applies the
 * authored stroke width normally. This module derives that centerline
 * path from the Kiwi fill contour and the authored alignment distance.
 */

import { flattenPathCommands } from "./flatten";
import type { PathCommand } from "./types";

const PARALLEL_EPSILON = 1e-6;
const CLOSED_POINT_EPSILON = 1e-6;

type Point = {
  readonly x: number;
  readonly y: number;
};

type Line = {
  readonly a: Point;
  readonly b: Point;
};

export type StrokeAlignedClosedPathOptions = {
  readonly flattenTolerance: number;
};

export function buildStrokeAlignedClosedPathCommands(
  commands: readonly PathCommand[],
  offsetDistance: number,
  options: StrokeAlignedClosedPathOptions,
): readonly PathCommand[] | undefined {
  if (offsetDistance <= 0) {
    return undefined;
  }
  if (!isSingleClosedSubpath(commands)) {
    return undefined;
  }

  const points = flattenedClosedPoints(commands, options.flattenTolerance);
  if (points === undefined || points.length < 3) {
    return undefined;
  }

  const area = signedArea(points);
  if (area === 0) {
    return undefined;
  }

  const offsetLines = buildOffsetLines(points, offsetDistance, area);
  const offsetPoints = points.map((_, index) => {
    const previous = offsetLines[(index + offsetLines.length - 1) % offsetLines.length];
    const current = offsetLines[index];
    return intersectLines(previous, current) ?? current.a;
  });

  return pointsToClosedPathCommands(offsetPoints);
}

function isSingleClosedSubpath(commands: readonly PathCommand[]): boolean {
  const moveCount = commands.filter((command) => command.type === "M").length;
  return moveCount === 1;
}

function flattenedClosedPoints(
  commands: readonly PathCommand[],
  tolerance: number,
): readonly Point[] | undefined {
  const raw = flattenPathCommands(commands, tolerance);
  if (raw.length < 8) {
    return undefined;
  }
  const points = numberPairsToPoints(raw);
  const first = points[0];
  const last = points[points.length - 1];
  if (!nearPoint(first, last)) {
    return undefined;
  }
  return points.slice(0, points.length - 1);
}

function numberPairsToPoints(values: readonly number[]): readonly Point[] {
  const points: Point[] = [];
  for (let index = 0; index < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] });
  }
  return points;
}

function nearPoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= CLOSED_POINT_EPSILON && Math.abs(a.y - b.y) <= CLOSED_POINT_EPSILON;
}

function signedArea(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function buildOffsetLines(
  points: readonly Point[],
  offsetDistance: number,
  area: number,
): readonly Line[] {
  const direction = area > 0 ? 1 : -1;
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    const nx = direction * dy / length;
    const ny = -direction * dx / length;
    return {
      a: { x: point.x + nx * offsetDistance, y: point.y + ny * offsetDistance },
      b: { x: next.x + nx * offsetDistance, y: next.y + ny * offsetDistance },
    };
  });
}

function intersectLines(first: Line, second: Line): Point | undefined {
  const x1 = first.a.x;
  const y1 = first.a.y;
  const x2 = first.b.x;
  const y2 = first.b.y;
  const x3 = second.a.x;
  const y3 = second.a.y;
  const x4 = second.b.x;
  const y4 = second.b.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < PARALLEL_EPSILON) {
    return undefined;
  }
  const firstCross = x1 * y2 - y1 * x2;
  const secondCross = x3 * y4 - y3 * x4;
  return {
    x: (firstCross * (x3 - x4) - (x1 - x2) * secondCross) / denominator,
    y: (firstCross * (y3 - y4) - (y1 - y2) * secondCross) / denominator,
  };
}

function pointsToClosedPathCommands(points: readonly Point[]): readonly PathCommand[] {
  const first = points[0];
  const rest = points.slice(1);
  return [
    { type: "M", x: first.x, y: first.y },
    ...rest.map((point): PathCommand => ({ type: "L", x: point.x, y: point.y })),
    { type: "Z" },
  ];
}
