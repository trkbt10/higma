/**
 * @file Serialise a `PathCommand[]` into an SVG path-`d` string.
 *
 * Two variants:
 *
 * - `pathCommandsToSvgPath` — configurable precision/separator, used by
 *   tooling that wants compact rounded output.
 * - `contourToSvgD` — compact (no leading separator after the command
 *   letter), unrounded floats, used by renderer pipelines that need
 *   exact float fidelity for round-trip with Figma exports.
 */

import type { AffineMatrix, PathCommand } from "./types";
import type { SvgPathOptions } from "./types";

const CLOSED_POINT_EPSILON = 1e-6;

type Point = {
  readonly x: number;
  readonly y: number;
};

type CloseCommandAccumulator = {
  readonly commands: readonly PathCommand[];
  readonly subpathStart?: Point;
  readonly currentPoint?: Point;
  readonly previousClosed: boolean;
  readonly subpathHasDrawn: boolean;
};

type SvgPathAccumulator = {
  readonly parts: readonly string[];
  readonly subpathStart?: Point;
  readonly currentPoint?: Point;
};

function unroundedSvgNumber(n: number): number {
  return n;
}

function svgNumberFormatter(precision: number | undefined): (n: number) => number {
  if (precision === undefined) {
    return unroundedSvgNumber;
  }
  const factor = Math.pow(10, precision);
  return (n: number) => Math.round(n * factor) / factor;
}

/**
 * Convert path commands to an SVG path-`d` string.
 *
 * Backwards-compatibility: callers that historically passed a bare
 * precision number (instead of an options object) are still honoured.
 *
 * Arc commands are serialised faithfully per the SVG grammar. The
 * `largeArc` / `sweep` flags are emitted as `0` / `1`.
 */
export function pathCommandsToSvgPath(
  commands: readonly PathCommand[],
  options: SvgPathOptions | number = {},
): string {
  const opts: SvgPathOptions = typeof options === "number" ? { precision: options } : options;
  const precision = opts.precision ?? 2;
  const sep = opts.separator ?? " ";

  const factor = Math.pow(10, precision);
  const r = (n: number) => Math.round(n * factor) / factor;

  const parts: string[] = [];

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        parts.push(`M${sep}${r(cmd.x)}${sep}${r(cmd.y)}`);
        break;
      case "L":
        parts.push(`L${sep}${r(cmd.x)}${sep}${r(cmd.y)}`);
        break;
      case "C":
        parts.push(
          `C${sep}${r(cmd.x1)}${sep}${r(cmd.y1)}${sep}${r(cmd.x2)}${sep}${r(cmd.y2)}${sep}${r(cmd.x)}${sep}${r(cmd.y)}`,
        );
        break;
      case "Q":
        parts.push(
          `Q${sep}${r(cmd.x1)}${sep}${r(cmd.y1)}${sep}${r(cmd.x)}${sep}${r(cmd.y)}`,
        );
        break;
      case "A":
        parts.push(
          `A${sep}${r(cmd.rx)}${sep}${r(cmd.ry)}${sep}${r(cmd.rotation)}${sep}${cmd.largeArc ? 1 : 0}${sep}${cmd.sweep ? 1 : 0}${sep}${r(cmd.x)}${sep}${r(cmd.y)}`,
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }

  return sep ? parts.join(" ") : parts.join("");
}

/**
 * Compact `PathContour` → SVG `d`. Optional `precision` rounds every
 * emitted coordinate to that many decimal places before stringifying;
 * leaving it undefined keeps full JS-float fidelity (the historical
 * behaviour, preserved so editor/round-trip callers that compare exact
 * path strings continue to work).
 *
 * Renderer pipelines that hand the output to a rasteriser (resvg/Skia)
 * should pass `precision: 3`. Figma's SVG exporter quantises path data
 * to ~3-decimal precision; matching that precision lets resvg's
 * antialiasing land on the same coverage approximation as Figma's
 * export (sub-millipixel FP drift in our text/vector pipeline otherwise
 * shifts resvg's coverage estimate by enough to change rendered pixels
 * around stem edges that fall mid-column).
 *
 * Structural typing on the input so it accepts any package's
 * `PathContour` variant (renderer's has a `fillOverride` sidecar,
 * primitives' has `fillRule`, etc.).
 */
export function contourToSvgD(
  contour: { readonly commands: readonly PathCommand[] },
  precision?: number,
): string {
  const commands = commandsWithFigmaCloseCommand(contour.commands);
  const r = svgNumberFormatter(precision);
  const initial: SvgPathAccumulator = { parts: [] };
  const accumulated = commands.reduce((acc, cmd) => appendSvgPathCommand(acc, cmd, r), initial);
  return accumulated.parts.join("");
}

function appendSvgPathCommand(
  acc: SvgPathAccumulator,
  cmd: PathCommand,
  r: (n: number) => number,
): SvgPathAccumulator {
  switch (cmd.type) {
    case "M": {
      const point = { x: r(cmd.x), y: r(cmd.y) };
      return {
        parts: [...acc.parts, `M${point.x} ${point.y}`],
        subpathStart: point,
        currentPoint: point,
      };
    }
    case "L": {
      const next = { x: r(cmd.x), y: r(cmd.y) };
      return {
        ...acc,
        parts: [...acc.parts, svgLineCommand(acc.currentPoint, next)],
        currentPoint: next,
      };
    }
    case "C": {
      const next = { x: r(cmd.x), y: r(cmd.y) };
      return {
        ...acc,
        parts: [...acc.parts, `C${r(cmd.x1)} ${r(cmd.y1)} ${r(cmd.x2)} ${r(cmd.y2)} ${next.x} ${next.y}`],
        currentPoint: next,
      };
    }
    case "Q": {
      const next = { x: r(cmd.x), y: r(cmd.y) };
      return {
        ...acc,
        parts: [...acc.parts, `Q${r(cmd.x1)} ${r(cmd.y1)} ${next.x} ${next.y}`],
        currentPoint: next,
      };
    }
    case "A": {
      const next = { x: r(cmd.x), y: r(cmd.y) };
      return {
        ...acc,
        parts: [...acc.parts, `A${r(cmd.rx)} ${r(cmd.ry)} ${r(cmd.rotation)} ${cmd.largeArc ? 1 : 0} ${cmd.sweep ? 1 : 0} ${next.x} ${next.y}`],
        currentPoint: next,
      };
    }
    case "Z":
      return {
        ...acc,
        parts: [...acc.parts, "Z"],
        currentPoint: acc.subpathStart,
      };
  }
}

function svgLineCommand(current: Point | undefined, next: Point): string {
  if (current === undefined) {
    return `L${next.x} ${next.y}`;
  }
  if (current.y === next.y) {
    return `H${next.x}`;
  }
  if (current.x === next.x) {
    return `V${next.y}`;
  }
  return `L${next.x} ${next.y}`;
}

function commandsWithFigmaCloseCommand(commands: readonly PathCommand[]): readonly PathCommand[] {
  const initial: CloseCommandAccumulator = {
    commands: [],
    previousClosed: false,
    subpathHasDrawn: false,
  };
  const accumulated = commands.reduce(applyFigmaCloseCommand, initial);
  return appendFigmaCloseCommand(accumulated).commands;
}

function applyFigmaCloseCommand(acc: CloseCommandAccumulator, command: PathCommand): CloseCommandAccumulator {
  switch (command.type) {
    case "M": {
      const closed = appendFigmaCloseCommand(acc);
      const point = { x: command.x, y: command.y };
      return {
        commands: [...closed.commands, command],
        subpathStart: point,
        currentPoint: point,
        previousClosed: false,
        subpathHasDrawn: false,
      };
    }
    case "Z":
      return {
        commands: [...acc.commands, command],
        subpathStart: undefined,
        currentPoint: acc.subpathStart,
        previousClosed: true,
        subpathHasDrawn: false,
      };
    case "L":
    case "C":
    case "Q":
    case "A":
      return {
        ...acc,
        commands: [...acc.commands, command],
        currentPoint: { x: command.x, y: command.y },
        previousClosed: false,
        subpathHasDrawn: true,
      };
  }
}

function appendFigmaCloseCommand(acc: CloseCommandAccumulator): CloseCommandAccumulator {
  if (!needsFigmaCloseCommand(acc)) {
    return acc;
  }
  return {
    ...acc,
    commands: [...acc.commands, { type: "Z" }],
    currentPoint: acc.subpathStart,
    previousClosed: true,
    subpathHasDrawn: false,
  };
}

function needsFigmaCloseCommand(acc: CloseCommandAccumulator): boolean {
  if (acc.previousClosed || !acc.subpathHasDrawn || acc.subpathStart === undefined || acc.currentPoint === undefined) {
    return false;
  }
  return nearPoint(acc.subpathStart, acc.currentPoint);
}

function nearPoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= CLOSED_POINT_EPSILON && Math.abs(a.y - b.y) <= CLOSED_POINT_EPSILON;
}

/**
 * Convert an AffineMatrix to an SVG `transform` attribute string.
 * Returns `undefined` for the identity matrix so callers can omit the
 * DOM attribute entirely.
 *
 * SVG matrix(a, b, c, d, e, f) = matrix(m00, m10, m01, m11, m02, m12).
 */
export function matrixToSvgTransform(m: AffineMatrix): string | undefined {
  if (
    Math.abs(m.m00 - 1) < 1e-6 &&
    Math.abs(m.m01) < 1e-6 &&
    Math.abs(m.m02) < 1e-6 &&
    Math.abs(m.m10) < 1e-6 &&
    Math.abs(m.m11 - 1) < 1e-6 &&
    Math.abs(m.m12) < 1e-6
  ) {
    return undefined;
  }
  return `matrix(${m.m00},${m.m10},${m.m01},${m.m11},${m.m02},${m.m12})`;
}
