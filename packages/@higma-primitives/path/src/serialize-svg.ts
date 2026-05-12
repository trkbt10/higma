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
 * Compact, unrounded `PathContour` → SVG `d`. Suitable when full float
 * precision must be preserved (renderer paths used in round-trip /
 * pixel-diff workflows).
 *
 * Structural typing on the input so it accepts any package's
 * `PathContour` variant (renderer's has a `fillOverride` sidecar,
 * primitives' has `fillRule`, etc.).
 */
export function contourToSvgD(
  contour: { readonly commands: readonly PathCommand[] },
): string {
  return contour.commands
    .map((cmd) => {
      switch (cmd.type) {
        case "M":
          return `M${cmd.x} ${cmd.y}`;
        case "L":
          return `L${cmd.x} ${cmd.y}`;
        case "C":
          return `C${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y}`;
        case "Q":
          return `Q${cmd.x1} ${cmd.y1} ${cmd.x} ${cmd.y}`;
        case "A":
          return `A${cmd.rx} ${cmd.ry} ${cmd.rotation} ${cmd.largeArc ? 1 : 0} ${cmd.sweep ? 1 : 0} ${cmd.x} ${cmd.y}`;
        case "Z":
          return "Z";
      }
    })
    .join("");
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
