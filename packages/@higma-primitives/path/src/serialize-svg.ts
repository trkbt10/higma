/**
 * @file Serialise a `PathCommand[]` into an SVG path-`d` string.
 */

import type { PathCommand, SvgPathOptions } from "./types";

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
