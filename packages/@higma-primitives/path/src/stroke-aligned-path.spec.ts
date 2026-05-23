/**
 * @file Stroke-aligned path construction tests.
 */

import { pathCommandsToSvgPath } from "./serialize-svg";
import {
  buildStrokeAlignedClosedPathCommands,
  buildStrokeGeometryBackedInsideStrokeCenterlineCommands,
  buildStrokeGeometryBackedOutsideStrokeCenterlineCommands,
} from "./stroke-aligned-path";
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

  it("uses Kiwi strokeGeometry cubics for simple outside-stroke arcs while keeping complex joins flattened", () => {
    const source: readonly PathCommand[] = [
      { type: "M", x: 14, y: 5.5 },
      {
        type: "C",
        x1: 14,
        y1: Number.parseFloat("7.191232204437256"),
        x2: Number.parseFloat("13.028472900390625"),
        y2: Number.parseFloat("8.70417594909668"),
        x: 11.5,
        y: Number.parseFloat("9.713088989257812"),
      },
      { type: "C", x1: 10.908686637878418, y1: 10.103402137756348, x2: 12.5, y2: 12.699487686157227, x: 11.5, y: 13 },
      { type: "C", x1: 9.5, y1: 13.601025581359863, x2: 7.880797863006592, y2: 11, x: 7, y: 11 },
      { type: "C", x1: 3.1340067386627197, y1: 11, x2: 0, y2: 8.537566184997559, x: 0, y: 5.5 },
      { type: "C", x1: 0, y1: 2.4624338150024414, x2: 3.1340067386627197, y2: 0, x: 7, y: 0 },
      { type: "C", x1: 10.86599349975586, y1: 0, x2: 14, y2: 2.4624338150024414, x: 14, y: 5.5 },
    ];
    const strokeGeometry: readonly PathCommand[] = [
      { type: "M", x: 14, y: 5.5 },
      { type: "L", x: 12.5, y: 5.5 },
      { type: "C", x1: 12.5, y1: 6.576292514801025, x2: 11.883444786071777, y2: 7.6626715660095215, x: 10.673667907714844, y: 8.461220741271973 },
      { type: "L", x: 11.5, y: Number.parseFloat("9.713088989257812") },
      { type: "L", x: 12.326332092285156, y: 10.964957237243652 },
      { type: "C", x1: 14.173501014709473, y1: 9.74567985534668, x2: 15.5, y2: 7.806171417236328, x: 15.5, y: 5.5 },
      { type: "L", x: 14, y: 5.5 },
      { type: "M", x: 7, y: 11 },
      { type: "L", x: 7, y: 9.5 },
      { type: "C", x1: 3.605293035507202, y1: 9.5, x2: 1.5, y2: 7.3922929763793945, x: 1.5, y: 5.5 },
      { type: "L", x: 0, y: 5.5 },
      { type: "L", x: -1.5, y: 5.5 },
      { type: "C", x1: -1.5, y1: 9.682839393615723, x2: 2.6627204418182373, y2: 12.5, x: 7, y: 12.5 },
      { type: "L", x: 7, y: 11 },
      { type: "M", x: 0, y: 5.5 },
      { type: "L", x: 1.5, y: 5.5 },
      { type: "C", x1: 1.5, y1: 3.6077072620391846, x2: 3.605293035507202, y2: 1.5, x: 7, y: 1.5 },
      { type: "L", x: 7, y: 0 },
      { type: "L", x: 7, y: -1.5 },
      { type: "C", x1: 2.6627204418182373, y1: -1.5, x2: -1.5, y2: 1.3171604871749878, x: -1.5, y: 5.5 },
      { type: "L", x: 0, y: 5.5 },
      { type: "M", x: 7, y: 0 },
      { type: "L", x: 7, y: 1.5 },
      { type: "C", x1: 10.394706726074219, y1: 1.5, x2: 12.5, y2: 3.6077072620391846, x: 12.5, y: 5.5 },
      { type: "L", x: 14, y: 5.5 },
      { type: "L", x: 15.5, y: 5.5 },
      { type: "C", x1: 15.5, y1: 1.3171604871749878, x2: 11.337279319763184, y2: -1.5, x: 7, y: -1.5 },
      { type: "L", x: 7, y: 0 },
    ];

    const centered = buildStrokeGeometryBackedOutsideStrokeCenterlineCommands(source, strokeGeometry, 0.75, { flattenTolerance: 0.001 });

    if (centered === undefined) {
      throw new Error("expected strokeGeometry-backed centerline");
    }
    expect(pathCommandsToSvgPath(centered, { precision: 3 })).toBe(
      "M 14.75 5.5 C 14.75 7.499 13.601 9.225 11.913 10.339 L 12.086 10.183 L 12.118 10.073 L 12.117 10.102 L 12.131 10.222 L 12.232 10.663 L 12.38 11.203 L 12.523 11.8 L 12.592 12.405 L 12.56 12.775 L 12.43 13.156 L 12.143 13.511 L 11.753 13.713 L 11.217 13.824 L 10.728 13.838 L 10.263 13.774 L 9.827 13.65 L 9.424 13.48 L 9.04 13.274 L 8.385 12.83 L 7.35 12.003 L 7.005 11.773 L 6.961 11.754 L 6.923 11.748 C 2.898 11.75 -0.75 9.11 -0.75 5.5 C -0.75 1.89 2.898 -0.75 7 -0.75 C 11.102 -0.75 14.75 1.89 14.75 5.5 Z",
    );
  });

  it("derives inside-stroke centerlines from Kiwi source and inner strokeGeometry boundaries", () => {
    const source: readonly PathCommand[] = [
      { type: "M", x: 310.3999938964844, y: 0 },
      {
        type: "C",
        x1: 352.9639892578125,
        y1: 0,
        x2: 374.2459716796875,
        y2: 0,
        x: 390.5032653808594,
        y: 8.283504486083984,
      },
      { type: "L", x: 310.3999938964844, y: 0 },
    ];
    const strokeGeometry: readonly PathCommand[] = [
      { type: "M", x: 310.3999938964844, y: 0 },
      { type: "L", x: 310.3999938964844, y: 6 },
      {
        type: "C",
        x1: 331.781005859375,
        y1: 6,
        x2: 347.4559020996094,
        y2: 6.004666328430176,
        x: 359.82806396484375,
        y: 7.015511512756348,
      },
      {
        type: "C",
        x1: 372.13018798828125,
        y1: 8.020633697509766,
        x2: 380.63751220703125,
        y2: 9.990594863891602,
        x: 387.7793273925781,
        y: 13.629544258117676,
      },
      { type: "L", x: 390.5032653808594, y: 8.283504486083984 },
      { type: "M", x: 390.5032653808594, y: 8.283504486083984 },
      { type: "L", x: 390.5032653808594, y: 14.283504486083984 },
      { type: "L", x: 310.3999938964844, y: 6 },
      { type: "L", x: 310.3999938964844, y: 0 },
    ];

    const centered = buildStrokeGeometryBackedInsideStrokeCenterlineCommands(source, strokeGeometry, 6);

    if (centered === undefined) {
      throw new Error("expected strokeGeometry-backed inside centerline");
    }
    expect(pathCommandsToSvgPath(centered, { precision: 3 })).toBe(
      "M 310.4 3 C 331.732 3 347.55 3.002 360.072 4.025 C 372.56 5.046 381.506 7.066 389.141 10.957 L 310.4 3 Z",
    );
  });
});
