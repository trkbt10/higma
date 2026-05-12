/**
 * @file Parse an SVG path-`d` attribute into the canonical
 * `PathCommand[]` representation.
 */

import type { PathCommand } from "./types";

/**
 * Parse an SVG path-`d` string into a `PathCommand` array.
 *
 * Handles `M / L / H / V / C / Q / A / Z` commands. Both absolute and
 * relative (lowercase) forms are accepted; the implementation only
 * recognises the uppercase letters and assumes absolute coordinates,
 * matching the prior renderer-side parser that produced this surface.
 * Whitespace and commas are accepted as coordinate separators per the
 * SVG path data grammar.
 *
 * Arc commands may carry multiple coordinate sets in one segment per
 * the SVG grammar; we split each `A` into one `PathCommand` per
 * 7-number group.
 */
export function parseSvgPathD(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const re = /([MLHVCQAZ])\s*((?:[^MLHVCQAZ]*)?)/gi;
  const matchRef = { value: undefined as RegExpExecArray | null | undefined };
  const currentXRef = { value: 0 };
  const currentYRef = { value: 0 };

  while ((matchRef.value = re.exec(d)) !== null) {
    const type = matchRef.value[1].toUpperCase();
    const args = matchRef.value[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    switch (type) {
      case "M":
        currentXRef.value = args[0];
        currentYRef.value = args[1];
        commands.push({ type: "M", x: currentXRef.value, y: currentYRef.value });
        break;
      case "L":
        currentXRef.value = args[0];
        currentYRef.value = args[1];
        commands.push({ type: "L", x: currentXRef.value, y: currentYRef.value });
        break;
      case "H":
        currentXRef.value = args[0];
        commands.push({ type: "L", x: currentXRef.value, y: currentYRef.value });
        break;
      case "V":
        currentYRef.value = args[0];
        commands.push({ type: "L", x: currentXRef.value, y: currentYRef.value });
        break;
      case "C":
        currentXRef.value = args[4];
        currentYRef.value = args[5];
        commands.push({
          type: "C",
          x1: args[0],
          y1: args[1],
          x2: args[2],
          y2: args[3],
          x: currentXRef.value,
          y: currentYRef.value,
        });
        break;
      case "Q":
        currentXRef.value = args[2];
        currentYRef.value = args[3];
        commands.push({
          type: "Q",
          x1: args[0],
          y1: args[1],
          x: currentXRef.value,
          y: currentYRef.value,
        });
        break;
      case "A": {
        // SVG Arc: A rx ry x-rotation large-arc-flag sweep-flag x y.
        // May carry multiple coordinate sets per segment.
        for (let ai = 0; ai + 6 < args.length; ai += 7) {
          const arcRx = args[ai];
          const arcRy = args[ai + 1];
          const rotation = args[ai + 2];
          const largeArc = args[ai + 3] !== 0;
          const sweep = args[ai + 4] !== 0;
          const endX = args[ai + 5];
          const endY = args[ai + 6];
          currentXRef.value = endX;
          currentYRef.value = endY;
          commands.push({
            type: "A",
            rx: arcRx,
            ry: arcRy,
            rotation,
            largeArc,
            sweep,
            x: endX,
            y: endY,
          });
        }
        break;
      }
      case "Z":
        commands.push({ type: "Z" });
        break;
    }
  }

  return commands;
}
