/**
 * @file Stroke-aligned closed path construction.
 *
 * Figma's SVG exporter cannot express `strokeAlign=OUTSIDE` on an
 * arbitrary closed SVG path. For simple closed vector contours it emits
 * the path that lies on the aligned stroke centerline, then applies the
 * authored stroke width normally. This module derives that centerline
 * path from the Kiwi fill contour and the authored alignment distance.
 */

import { flattenCubicBezier, flattenPathCommands } from "./flatten";
import type { PathCommand } from "./types";

const PARALLEL_EPSILON = 1e-6;
const CLOSED_POINT_EPSILON = 1e-6;
const STROKE_GEOMETRY_POINT_EPSILON = 1e-3;
const BEZIER_FLATTEN_MAX_DEPTH = 20;

type Point = {
  readonly x: number;
  readonly y: number;
};

type Line = {
  readonly a: Point;
  readonly b: Point;
};

type CubicCommand = Extract<PathCommand, { readonly type: "C" }>;

type SourceSegment = {
  readonly index: number;
  readonly start: Point;
  readonly end: Point;
  readonly command: Exclude<PathCommand, { readonly type: "M" | "Z" }>;
};

type AlignedPathData = {
  readonly points: readonly Point[];
  readonly pointSegmentIndexes: readonly number[];
  readonly segments: readonly SourceSegment[];
};

type StrokeGeometryCenterlineCubic = {
  readonly start: Point;
  readonly command: CubicCommand;
};

type CenterlinePathSegment = {
  readonly start: Point;
  readonly command: Exclude<PathCommand, { readonly type: "M" | "Z" }>;
};

type CubicPathSegment = {
  readonly start: Point;
  readonly command: CubicCommand;
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

export function buildStrokeGeometryBackedOutsideStrokeCenterlineCommands(
  commands: readonly PathCommand[],
  strokeGeometryCommands: readonly PathCommand[],
  offsetDistance: number,
  options: StrokeAlignedClosedPathOptions,
): readonly PathCommand[] | undefined {
  if (offsetDistance <= 0) {
    return undefined;
  }
  const aligned = buildStrokeAlignedClosedPathData(commands, offsetDistance, options);
  if (aligned === undefined) {
    return undefined;
  }
  const centerlineCubics = resolveStrokeGeometryCenterlineCubics(aligned.segments, strokeGeometryCommands, offsetDistance);
  if (centerlineCubics.size === 0) {
    return undefined;
  }
  return mergeAlignedPointsWithStrokeGeometryCubics(aligned, centerlineCubics);
}

export function buildStrokeGeometryBackedInsideStrokeCenterlineCommands(
  commands: readonly PathCommand[],
  strokeGeometryCommands: readonly PathCommand[],
  strokeWidth: number,
): readonly PathCommand[] | undefined {
  if (strokeWidth <= 0) {
    return undefined;
  }
  const segments = sourceSegmentsFromSingleClosedSubpath(commands);
  if (segments === undefined) {
    return undefined;
  }
  const strokeGeometrySubpaths = splitSubpaths(strokeGeometryCommands);
  const centerlineSegments: CenterlinePathSegment[] = [];
  for (const segment of segments) {
    const centerline = resolveInsideStrokeGeometryCenterlineSegment(segment, strokeGeometrySubpaths, strokeWidth);
    if (centerline === undefined) {
      return undefined;
    }
    centerlineSegments.push(...centerline);
  }
  return centerlineSegmentsToClosedPathCommands(rotateCenterlineSegmentsToTopEdge(centerlineSegments));
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

function buildStrokeAlignedClosedPathData(
  commands: readonly PathCommand[],
  offsetDistance: number,
  options: StrokeAlignedClosedPathOptions,
): AlignedPathData | undefined {
  if (!isSingleClosedSubpath(commands)) {
    return undefined;
  }

  const flattened = flattenedClosedPointsWithSegments(commands, options.flattenTolerance);
  if (flattened === undefined || flattened.points.length < 3) {
    return undefined;
  }

  const area = signedArea(flattened.points);
  if (area === 0) {
    return undefined;
  }

  const offsetLines = buildOffsetLines(flattened.points, offsetDistance, area);
  const points = flattened.points.map((_, index) => {
    const previous = offsetLines[(index + offsetLines.length - 1) % offsetLines.length];
    const current = offsetLines[index];
    return intersectLines(previous, current) ?? current.a;
  });

  return {
    points,
    pointSegmentIndexes: flattened.pointSegmentIndexes,
    segments: flattened.segments,
  };
}

function flattenedClosedPointsWithSegments(
  commands: readonly PathCommand[],
  tolerance: number,
): { readonly points: readonly Point[]; readonly pointSegmentIndexes: readonly number[]; readonly segments: readonly SourceSegment[] } | undefined {
  const segments = sourceSegmentsFromSingleClosedSubpath(commands);
  if (segments === undefined) {
    return undefined;
  }
  const first = segments[0]?.start;
  if (first === undefined) {
    return undefined;
  }

  const points: Point[] = [first];
  const pointSegmentIndexes: number[] = [-1];
  for (const segment of segments) {
    const segmentPoints = flattenSourceSegment(segment, tolerance);
    for (const point of segmentPoints) {
      points.push(point);
      pointSegmentIndexes.push(segment.index);
    }
  }

  const last = points[points.length - 1];
  if (!nearPoint(first, last)) {
    return undefined;
  }
  return {
    points: points.slice(0, points.length - 1),
    pointSegmentIndexes: pointSegmentIndexes.slice(0, pointSegmentIndexes.length - 1),
    segments,
  };
}

function sourceSegmentsFromSingleClosedSubpath(commands: readonly PathCommand[]): readonly SourceSegment[] | undefined {
  if (!isSingleClosedSubpath(commands)) {
    return undefined;
  }

  const segments: SourceSegment[] = [];
  let current: Point | undefined;
  let start: Point | undefined;
  for (const command of commands) {
    switch (command.type) {
      case "M":
        current = { x: command.x, y: command.y };
        start = current;
        continue;
      case "Z":
        if (current === undefined || start === undefined) {
          return undefined;
        }
        if (!nearPoint(current, start)) {
          segments.push({
            index: segments.length,
            start: current,
            end: start,
            command: { type: "L", x: start.x, y: start.y },
          });
        }
        current = start;
        continue;
    }
    const segmentStart = current;
    if (segmentStart === undefined) {
      return undefined;
    }
    const end = commandEndPoint(command);
    segments.push({
      index: segments.length,
      start: segmentStart,
      end,
      command,
    });
    current = end;
  }

  if (segments.length === 0) {
    return undefined;
  }
  const first = segments[0].start;
  const last = segments[segments.length - 1].end;
  if (!nearPoint(first, last)) {
    return undefined;
  }
  return segments;
}

function commandEndPoint(command: Exclude<PathCommand, { readonly type: "M" | "Z" }>): Point {
  return { x: command.x, y: command.y };
}

function commandPoint(command: PathCommand): Point | undefined {
  if (command.type === "M" || command.type === "L" || command.type === "C" || command.type === "Q" || command.type === "A") {
    return { x: command.x, y: command.y };
  }
  return undefined;
}

function flattenSourceSegment(segment: SourceSegment, tolerance: number): readonly Point[] {
  const command = segment.command;
  if (command.type === "L") {
    return [segment.end];
  }
  if (command.type === "C") {
    const values: number[] = [];
    flattenCubicBezier({
      x0: segment.start.x,
      y0: segment.start.y,
      x1: command.x1,
      y1: command.y1,
      x2: command.x2,
      y2: command.y2,
      x3: command.x,
      y3: command.y,
      tolerance,
      points: values,
      depth: BEZIER_FLATTEN_MAX_DEPTH,
    });
    return numberPairsToPoints(values);
  }
  return [segment.end];
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

function resolveStrokeGeometryCenterlineCubics(
  segments: readonly SourceSegment[],
  strokeGeometryCommands: readonly PathCommand[],
  offsetDistance: number,
): ReadonlyMap<number, StrokeGeometryCenterlineCubic> {
  const entries = segments.flatMap((segment) => {
    const cubic = resolveStrokeGeometryCenterlineCubic(segment, strokeGeometryCommands, offsetDistance);
    if (cubic === undefined) {
      return [];
    }
    return [[segment.index, cubic] as const];
  });
  return new Map(entries);
}

function resolveStrokeGeometryCenterlineCubic(
  segment: SourceSegment,
  strokeGeometryCommands: readonly PathCommand[],
  offsetDistance: number,
): StrokeGeometryCenterlineCubic | undefined {
  if (segment.command.type !== "C") {
    return undefined;
  }
  const subpath = findStrokeGeometrySubpathForSegment(segment, splitSubpaths(strokeGeometryCommands));
  if (subpath === undefined) {
    return undefined;
  }
  const outer = readSingleCubicOuterStrokeBoundary(segment, subpath, offsetDistance);
  if (outer === undefined) {
    return undefined;
  }
  return {
    start: midpoint(segment.start, outer.start),
    command: {
      type: "C",
      x1: midpointNumber(segment.command.x1, outer.command.x1),
      y1: midpointNumber(segment.command.y1, outer.command.y1),
      x2: midpointNumber(segment.command.x2, outer.command.x2),
      y2: midpointNumber(segment.command.y2, outer.command.y2),
      x: midpointNumber(segment.command.x, outer.command.x),
      y: midpointNumber(segment.command.y, outer.command.y),
    },
  };
}

function splitSubpaths(commands: readonly PathCommand[]): readonly (readonly PathCommand[])[] {
  const subpaths: PathCommand[][] = [];
  let current: PathCommand[] | undefined;
  for (const command of commands) {
    if (command.type === "M") {
      current = [command];
      subpaths.push(current);
      continue;
    }
    if (current === undefined) {
      return [];
    }
    current.push(command);
  }
  return subpaths;
}

function findStrokeGeometrySubpathForSegment(
  segment: SourceSegment,
  subpaths: readonly (readonly PathCommand[])[],
): readonly PathCommand[] | undefined {
  return subpaths.find((subpath) => {
    const first = subpath[0];
    if (first?.type !== "M" || !nearStrokeGeometryPoint(first, segment.start)) {
      return false;
    }
    return subpath.some((command) => {
      const point = commandPoint(command);
      if (point === undefined) {
        return false;
      }
      return nearStrokeGeometryPoint(point, segment.end);
    });
  });
}

function readSingleCubicOuterStrokeBoundary(
  segment: SourceSegment,
  subpath: readonly PathCommand[],
  offsetDistance: number,
): { readonly start: Point; readonly command: CubicCommand } | undefined {
  const segmentEndIndex = subpath.findIndex((command, index) => {
    if (index === 0 || command.type === "M") {
      return false;
    }
    const point = commandPoint(command);
    if (point === undefined) {
      return false;
    }
    return nearStrokeGeometryPoint(point, segment.end);
  });
  if (segmentEndIndex < 0) {
    return undefined;
  }
  const outerEnd = subpath[segmentEndIndex + 1];
  const reversedOuter = subpath[segmentEndIndex + 2];
  const closesToStart = subpath[segmentEndIndex + 3];
  if (outerEnd === undefined || outerEnd.type !== "L" || reversedOuter?.type !== "C" || closesToStart?.type !== "L") {
    return undefined;
  }
  if (!nearStrokeGeometryPoint(commandEndPoint(closesToStart), segment.start)) {
    return undefined;
  }
  const outerStart = { x: reversedOuter.x, y: reversedOuter.y };
  const expectedFullStrokeDistance = offsetDistance * 2;
  if (!matchesFullStrokeDistance(segment.start, outerStart, expectedFullStrokeDistance)) {
    return undefined;
  }
  if (!matchesFullStrokeDistance(segment.end, outerEnd, expectedFullStrokeDistance)) {
    return undefined;
  }
  return {
    start: outerStart,
    command: {
      type: "C",
      x1: reversedOuter.x2,
      y1: reversedOuter.y2,
      x2: reversedOuter.x1,
      y2: reversedOuter.y1,
      x: outerEnd.x,
      y: outerEnd.y,
    },
  };
}

function resolveInsideStrokeGeometryCenterlineSegment(
  segment: SourceSegment,
  subpaths: readonly (readonly PathCommand[])[],
  strokeWidth: number,
): readonly CenterlinePathSegment[] | undefined {
  const subpath = findInsideStrokeGeometrySubpathForSegment(segment, subpaths);
  if (subpath === undefined) {
    return undefined;
  }
  const inner = readInsideStrokeBoundary(segment, subpath, strokeWidth);
  if (inner === undefined) {
    return undefined;
  }
  if (segment.command.type === "L") {
    return resolveInsideLineCenterlineSegment(segment, inner);
  }
  if (segment.command.type === "C") {
    return resolveInsideCubicCenterlineSegments(segment, inner);
  }
  return undefined;
}

function findInsideStrokeGeometrySubpathForSegment(
  segment: SourceSegment,
  subpaths: readonly (readonly PathCommand[])[],
): InsideStrokeGeometrySubpath | undefined {
  const forward = subpaths.find((subpath) => {
    const first = subpath[0];
    if (first?.type !== "M" || !nearStrokeGeometryPoint(first, segment.start)) {
      return false;
    }
    return subpath.some((command) => {
      const point = commandPoint(command);
      return point !== undefined && nearStrokeGeometryPoint(point, segment.end);
    });
  });
  if (forward !== undefined) {
    return { commands: forward, reversed: false };
  }
  const reversed = subpaths.find((subpath) => {
    const first = subpath[0];
    if (first?.type !== "M" || !nearStrokeGeometryPoint(first, segment.end)) {
      return false;
    }
    return subpath.some((command) => {
      const point = commandPoint(command);
      return point !== undefined && nearStrokeGeometryPoint(point, segment.start);
    });
  });
  if (reversed === undefined) {
    return undefined;
  }
  return { commands: reversed, reversed: true };
}

type InsideStrokeBoundary = {
  readonly start: Point;
  readonly commands: readonly Exclude<PathCommand, { readonly type: "M" | "Z" }>[];
};

type InsideStrokeGeometrySubpath = {
  readonly commands: readonly PathCommand[];
  readonly reversed: boolean;
};

function readInsideStrokeBoundary(
  segment: SourceSegment,
  subpath: InsideStrokeGeometrySubpath,
  strokeWidth: number,
): InsideStrokeBoundary | undefined {
  const commands = subpath.commands;
  if (subpath.reversed) {
    return readInsideStrokeBoundaryFromReversedSubpath(segment, commands, strokeWidth);
  }
  return readInsideStrokeBoundaryFromForwardSubpath(segment, commands, strokeWidth);
}

function readInsideStrokeBoundaryFromForwardSubpath(
  segment: SourceSegment,
  commands: readonly PathCommand[],
  strokeWidth: number,
): InsideStrokeBoundary | undefined {
  const innerStartCommand = commands[1];
  if (innerStartCommand?.type !== "L") {
    return undefined;
  }
  const sourceEndIndex = commands.findIndex((command, index) => {
    if (index <= 1 || command.type !== "L") {
      return false;
    }
    return nearStrokeGeometryPoint(commandEndPoint(command), segment.end);
  });
  if (sourceEndIndex < 0) {
    return undefined;
  }
  const rawInnerCommands = commands.slice(2, sourceEndIndex).filter(isDrawableCommand);
  return buildInsideStrokeBoundary(segment, commandEndPoint(innerStartCommand), rawInnerCommands, strokeWidth);
}

function readInsideStrokeBoundaryFromReversedSubpath(
  segment: SourceSegment,
  commands: readonly PathCommand[],
  strokeWidth: number,
): InsideStrokeBoundary | undefined {
  const sourceStartIndex = commands.findIndex((command, index) => {
    if (index <= 1 || command.type !== "L") {
      return false;
    }
    return nearStrokeGeometryPoint(commandEndPoint(command), segment.start);
  });
  if (sourceStartIndex < 0) {
    return undefined;
  }
  const innerStartCommand = commands[sourceStartIndex + 1];
  if (innerStartCommand?.type !== "L") {
    return undefined;
  }
  const sourceEndIndex = commands.findIndex((command, index) => {
    if (index <= sourceStartIndex + 1 || command.type !== "L") {
      return false;
    }
    return nearStrokeGeometryPoint(commandEndPoint(command), segment.end);
  });
  if (sourceEndIndex < 0) {
    return undefined;
  }
  const rawInnerCommands = commands.slice(sourceStartIndex + 2, sourceEndIndex).filter(isDrawableCommand);
  return buildInsideStrokeBoundary(segment, commandEndPoint(innerStartCommand), rawInnerCommands, strokeWidth);
}

function buildInsideStrokeBoundary(
  segment: SourceSegment,
  innerStart: Point,
  innerCommands: readonly Exclude<PathCommand, { readonly type: "M" | "Z" }>[],
  strokeWidth: number,
): InsideStrokeBoundary | undefined {
  const innerEndCommand = innerCommands[innerCommands.length - 1];
  if (innerEndCommand === undefined) {
    return undefined;
  }
  const innerEnd = commandEndPoint(innerEndCommand);
  if (!matchesFullStrokeDistance(segment.start, innerStart, strokeWidth)) {
    return undefined;
  }
  if (!matchesFullStrokeDistance(segment.end, innerEnd, strokeWidth)) {
    return undefined;
  }
  return {
    start: innerStart,
    commands: innerCommands,
  };
}

function isDrawableCommand(command: PathCommand): command is Exclude<PathCommand, { readonly type: "M" | "Z" }> {
  return command.type !== "M" && command.type !== "Z";
}

function resolveInsideLineCenterlineSegment(
  segment: SourceSegment,
  inner: InsideStrokeBoundary,
): readonly CenterlinePathSegment[] | undefined {
  if (segment.command.type !== "L") {
    return undefined;
  }
  const innerCommand = inner.commands[0];
  if (inner.commands.length !== 1 || innerCommand?.type !== "L") {
    return undefined;
  }
  return [{
    start: kiwiStrokeGeometryMidpoint(segment.start, inner.start),
    command: {
      type: "L",
      x: kiwiStrokeGeometryMidpointNumber(segment.command.x, innerCommand.x),
      y: kiwiStrokeGeometryMidpointNumber(segment.command.y, innerCommand.y),
    },
  }];
}

function resolveInsideCubicCenterlineSegments(
  segment: SourceSegment,
  inner: InsideStrokeBoundary,
): readonly CenterlinePathSegment[] | undefined {
  if (segment.command.type !== "C" || !inner.commands.every(isCubicCommand)) {
    return undefined;
  }
  const innerCubics = inner.commands;
  const sourceCubics = splitCubicIntoEqualParts(segment.start, segment.command, innerCubics.length);
  const innerStarts = innerBoundarySegmentStarts(inner);
  return sourceCubics.map((source, index): CenterlinePathSegment => {
    const innerCommand = innerCubics[index];
    const innerStart = innerStarts[index];
    return {
      start: kiwiStrokeGeometryMidpoint(source.start, innerStart),
      command: {
        type: "C",
        x1: kiwiStrokeGeometryMidpointNumber(source.command.x1, innerCommand.x1),
        y1: kiwiStrokeGeometryMidpointNumber(source.command.y1, innerCommand.y1),
        x2: kiwiStrokeGeometryMidpointNumber(source.command.x2, innerCommand.x2),
        y2: kiwiStrokeGeometryMidpointNumber(source.command.y2, innerCommand.y2),
        x: kiwiStrokeGeometryMidpointNumber(source.command.x, innerCommand.x),
        y: kiwiStrokeGeometryMidpointNumber(source.command.y, innerCommand.y),
      },
    };
  });
}

function isCubicCommand(command: Exclude<PathCommand, { readonly type: "M" | "Z" }>): command is CubicCommand {
  return command.type === "C";
}

function innerBoundarySegmentStarts(inner: InsideStrokeBoundary): readonly Point[] {
  const starts: Point[] = [inner.start];
  for (const command of inner.commands.slice(0, -1)) {
    starts.push(commandEndPoint(command));
  }
  return starts;
}

function splitCubicIntoEqualParts(
  start: Point,
  command: CubicCommand,
  parts: number,
): readonly CubicPathSegment[] {
  if (parts === 1) {
    return [{ start, command }];
  }
  const split = splitCubicAt(start, command, 1 / parts);
  return [
    split.first,
    ...splitCubicIntoEqualParts(split.second.start, split.second.command, parts - 1),
  ];
}

function splitCubicAt(
  start: Point,
  command: CubicCommand,
  t: number,
): { readonly first: CubicPathSegment; readonly second: CubicPathSegment } {
  const p0 = start;
  const c0 = { x: command.x1, y: command.y1 };
  const c1 = { x: command.x2, y: command.y2 };
  const p3 = { x: command.x, y: command.y };
  const l0 = lerpPoint(p0, c0, t);
  const l1 = lerpPoint(c0, c1, t);
  const l2 = lerpPoint(c1, p3, t);
  const m0 = lerpPoint(l0, l1, t);
  const m1 = lerpPoint(l1, l2, t);
  const split = lerpPoint(m0, m1, t);
  return {
    first: {
      start: p0,
      command: { type: "C", x1: l0.x, y1: l0.y, x2: m0.x, y2: m0.y, x: split.x, y: split.y },
    },
    second: {
      start: split,
      command: { type: "C", x1: m1.x, y1: m1.y, x2: l2.x, y2: l2.y, x: p3.x, y: p3.y },
    },
  };
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: kiwiStrokeGeometryLerpNumber(a.x, b.x, t),
    y: kiwiStrokeGeometryLerpNumber(a.y, b.y, t),
  };
}

function kiwiStrokeGeometryLerpNumber(a: number, b: number, t: number): number {
  return Math.fround(Math.fround(a) + Math.fround(Math.fround(b - a) * Math.fround(t)));
}

function centerlineSegmentsToClosedPathCommands(segments: readonly CenterlinePathSegment[]): readonly PathCommand[] | undefined {
  const first = segments[0];
  if (first === undefined) {
    return undefined;
  }
  return [
    { type: "M", x: first.start.x, y: first.start.y },
    ...segments.map((segment) => segment.command),
    { type: "Z" },
  ];
}

function rotateCenterlineSegmentsToTopEdge(
  segments: readonly CenterlinePathSegment[],
): readonly CenterlinePathSegment[] {
  const index = topEdgeSegmentIndex(segments);
  if (index === undefined || index === 0) {
    return segments;
  }
  return [...segments.slice(index), ...segments.slice(0, index)];
}

function topEdgeSegmentIndex(segments: readonly CenterlinePathSegment[]): number | undefined {
  const points = segments.flatMap((segment) => [segment.start, commandEndPoint(segment.command)]);
  if (points.length === 0) {
    return undefined;
  }
  const minY = Math.min(...points.map((point) => point.y));
  const candidates = segments
    .map((segment, index) => ({ segment, index, length: horizontalLength(segment) }))
    .filter((candidate) => {
      if (candidate.segment.command.type !== "L") {
        return false;
      }
      const end = commandEndPoint(candidate.segment.command);
      return nearTopEdge(candidate.segment.start.y, minY) && nearTopEdge(end.y, minY) && candidate.length > 0;
    });
  return candidates.reduce<undefined | { readonly index: number; readonly length: number }>((best, candidate) => {
    if (best === undefined || candidate.length > best.length) {
      return { index: candidate.index, length: candidate.length };
    }
    return best;
  }, undefined)?.index;
}

function horizontalLength(segment: CenterlinePathSegment): number {
  if (segment.command.type !== "L") {
    return 0;
  }
  return Math.abs(segment.command.x - segment.start.x);
}

function nearTopEdge(value: number, minY: number): boolean {
  return Math.abs(value - minY) <= STROKE_GEOMETRY_POINT_EPSILON;
}

function matchesFullStrokeDistance(source: Point, outer: Point, fullStrokeWidth: number): boolean {
  return Math.abs(Math.hypot(source.x - outer.x, source.y - outer.y) - fullStrokeWidth) <= Math.max(0.05, fullStrokeWidth * 0.1);
}

function mergeAlignedPointsWithStrokeGeometryCubics(
  aligned: AlignedPathData,
  cubics: ReadonlyMap<number, StrokeGeometryCenterlineCubic>,
): readonly PathCommand[] | undefined {
  const firstPoint = aligned.points[0];
  if (firstPoint === undefined) {
    return undefined;
  }
  const firstSegment = aligned.segments[0];
  const firstCubic = firstSegment === undefined ? undefined : cubics.get(firstSegment.index);
  const commands: PathCommand[] = [{
    type: "M",
    x: firstCubic?.start.x ?? firstPoint.x,
    y: firstCubic?.start.y ?? firstPoint.y,
  }];
  const emittedCubics = new Set<number>();

  for (let index = 1; index < aligned.points.length; index += 1) {
    const segmentIndex = aligned.pointSegmentIndexes[index];
    const cubic = cubics.get(segmentIndex);
    if (cubic === undefined) {
      const point = aligned.points[index];
      commands.push({ type: "L", x: point.x, y: point.y });
      continue;
    }
    if (emittedCubics.has(segmentIndex)) {
      continue;
    }
    commands.push(cubic.command);
    emittedCubics.add(segmentIndex);
  }
  commands.push({ type: "Z" });
  return commands;
}

function nearStrokeGeometryPoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= STROKE_GEOMETRY_POINT_EPSILON && Math.abs(a.y - b.y) <= STROKE_GEOMETRY_POINT_EPSILON;
}

function midpoint(a: Point, b: Point): Point {
  return { x: midpointNumber(a.x, b.x), y: midpointNumber(a.y, b.y) };
}

function midpointNumber(a: number, b: number): number {
  return (a + b) / 2;
}

function kiwiStrokeGeometryMidpoint(a: Point, b: Point): Point {
  return { x: kiwiStrokeGeometryMidpointNumber(a.x, b.x), y: kiwiStrokeGeometryMidpointNumber(a.y, b.y) };
}

function kiwiStrokeGeometryMidpointNumber(a: number, b: number): number {
  return Math.fround(Math.fround(a + b) / 2);
}
