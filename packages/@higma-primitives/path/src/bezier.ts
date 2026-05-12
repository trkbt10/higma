/**
 * @file Bézier elevation — convert quadratic commands to cubics.
 *
 * Figma exports all glyph outlines as quadratics (TrueType native),
 * but most consumers (SVG, SwiftUI, Godot, the WebGL tessellator)
 * speak cubics. Elevating Q to C up-front lets the downstream code
 * carry a single curve representation.
 */

import type { PathCommand } from "./types";

/**
 * Replace every `Q` command in the input with a degree-elevated `C`
 * command, leaving every other command untouched.
 *
 * Q(P0, P1, P2) → C(P0, CP1, CP2, P2) with:
 *   CP1 = P0 + 2/3 · (P1 - P0)
 *   CP2 = P2 + 2/3 · (P1 - P2)
 *
 * The function tracks the running cursor so Q's implicit P0 is taken
 * from the previous endpoint. Arc commands are passed through
 * unchanged — they are not part of the Q→C contract.
 */
export function convertQuadraticsToCubic(
  commands: readonly PathCommand[],
): PathCommand[] {
  const result: PathCommand[] = [];
  const currentXRef = { value: 0 };
  const currentYRef = { value: 0 };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        result.push(cmd);
        break;

      case "L":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        result.push(cmd);
        break;

      case "Q": {
        const p0x = currentXRef.value;
        const p0y = currentYRef.value;
        const p1x = cmd.x1;
        const p1y = cmd.y1;
        const p2x = cmd.x;
        const p2y = cmd.y;

        const cp1x = p0x + (2 / 3) * (p1x - p0x);
        const cp1y = p0y + (2 / 3) * (p1y - p0y);
        const cp2x = p2x + (2 / 3) * (p1x - p2x);
        const cp2y = p2y + (2 / 3) * (p1y - p2y);

        result.push({
          type: "C",
          x1: cp1x,
          y1: cp1y,
          x2: cp2x,
          y2: cp2y,
          x: p2x,
          y: p2y,
        });

        currentXRef.value = p2x;
        currentYRef.value = p2y;
        break;
      }

      case "C":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        result.push(cmd);
        break;

      case "A":
        currentXRef.value = cmd.x;
        currentYRef.value = cmd.y;
        result.push(cmd);
        break;

      case "Z":
        result.push(cmd);
        break;
    }
  }

  return result;
}
