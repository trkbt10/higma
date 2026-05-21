/**
 * @file Stroke-aligned path construction tests.
 */

import { pathCommandsToSvgPath } from "./serialize-svg";
import { buildStrokeAlignedClosedPathCommands } from "./stroke-aligned-path";
import type { PathCommand } from "./types";

const OPTIONS = { flattenTolerance: 0.01 };

describe("buildStrokeAlignedClosedPathCommands", () => {
  it("expands a single closed contour by the supplied stroke-centerline offset", () => {
    const square: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
      { type: "L", x: 0, y: 10 },
      { type: "Z" },
    ];

    const aligned = buildStrokeAlignedClosedPathCommands(square, 1, OPTIONS);

    if (aligned === undefined) {
      throw new Error("expected closed square to produce stroke-aligned commands");
    }
    expect(pathCommandsToSvgPath(aligned, 4)).toBe("M -1 -1 L 11 -1 L 11 11 L -1 11 Z");
  });

  it("rejects open paths because stroke alignment needs a closed fill contour", () => {
    const open: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
    ];

    expect(buildStrokeAlignedClosedPathCommands(open, 1, OPTIONS)).toBeUndefined();
  });

  it("accepts Figma contours that close by returning to the start point without Z", () => {
    const implicitClosed: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
      { type: "L", x: 0, y: 10 },
      { type: "L", x: 0, y: 0 },
    ];

    const aligned = buildStrokeAlignedClosedPathCommands(implicitClosed, 1, OPTIONS);

    if (aligned === undefined) {
      throw new Error("expected implicitly closed square to produce stroke-aligned commands");
    }
    expect(pathCommandsToSvgPath(aligned, 4)).toBe("M -1 -1 L 11 -1 L 11 11 L -1 11 Z");
  });

  it("rejects compound paths so boolean geometry stays on the strokeGeometry mask path", () => {
    const compound: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
      { type: "Z" },
      { type: "M", x: 2, y: 2 },
      { type: "L", x: 4, y: 2 },
      { type: "L", x: 4, y: 4 },
      { type: "Z" },
    ];

    expect(buildStrokeAlignedClosedPathCommands(compound, 1, OPTIONS)).toBeUndefined();
  });
});
