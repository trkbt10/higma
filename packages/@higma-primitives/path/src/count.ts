/**
 * @file Count distinct subpaths in a path command stream.
 */

import type { PathCommand } from "./types";

/**
 * Count distinct subpaths in a decoded command list. Every `M`
 * (`move`) instruction starts a new subpath; the leading `M` counts
 * as the first one, so a path with two `M` commands has two
 * subpaths. Paths without any `M` (e.g. an empty geometry blob)
 * report `0`.
 */
export function countSubpaths(commands: readonly PathCommand[]): number {
  return commands.reduce((n, cmd) => (cmd.type === "M" ? n + 1 : n), 0);
}
