/**
 * @file Unit specs for `@higma-primitives/path`.
 *
 * Anchors the SoT behaviour for the path operations shared across
 * every higma package — parse / serialise round-trip, arc → cubic
 * conversion, affine transforms, bounding boxes, and the primitive
 * contour generators.
 */

import { arcToCubicBeziers } from "./arc";
import { pathCommandsBoundingBox } from "./bbox";
import {
  generateEllipseContour,
  generateLineContour,
  generatePolygonContour,
  generateRectContour,
  generateStarContour,
} from "./contours";
import { parseSvgPathD } from "./parse-svg";
import { pathCommandsToSvgPath } from "./serialize-svg";
import { transformPathCommands } from "./transform";
import type { AffineMatrix, PathCommand } from "./types";

const IDENTITY: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function approx(a: number, b: number, eps = 1e-6): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
}

function assertPathCommandType<T extends PathCommand["type"]>(
  command: PathCommand,
  type: T,
): asserts command is Extract<PathCommand, { readonly type: T }> {
  expect(command.type).toBe(type);
  if (command.type !== type) { throw new Error(`Expected ${type} command`); }
}

function approxCommands(
  actual: readonly PathCommand[],
  expected: readonly PathCommand[],
  eps = 1e-6,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    expect(a.type).toBe(e.type);
    if (a.type === "M") {
      assertPathCommandType(e, "M");
      approx(a.x, e.x, eps);
      approx(a.y, e.y, eps);
      continue;
    }
    if (a.type === "L") {
      assertPathCommandType(e, "L");
      approx(a.x, e.x, eps);
      approx(a.y, e.y, eps);
      continue;
    }
    if (a.type === "C") {
      assertPathCommandType(e, "C");
      approx(a.x1, e.x1, eps);
      approx(a.y1, e.y1, eps);
      approx(a.x2, e.x2, eps);
      approx(a.y2, e.y2, eps);
      approx(a.x, e.x, eps);
      approx(a.y, e.y, eps);
      continue;
    }
    if (a.type === "Q") {
      assertPathCommandType(e, "Q");
      approx(a.x1, e.x1, eps);
      approx(a.y1, e.y1, eps);
      approx(a.x, e.x, eps);
      approx(a.y, e.y, eps);
      continue;
    }
    if (a.type === "A") {
      assertPathCommandType(e, "A");
      approx(a.rx, e.rx, eps);
      approx(a.ry, e.ry, eps);
      approx(a.rotation, e.rotation, eps);
      expect(a.largeArc).toBe(e.largeArc);
      expect(a.sweep).toBe(e.sweep);
      approx(a.x, e.x, eps);
      approx(a.y, e.y, eps);
      continue;
    }
    expect(a.type).toBe(e.type);
  }
}

describe("parseSvgPathD", () => {
  it("parses absolute M / L into endpoints", () => {
    const cmds = parseSvgPathD("M 0 0 L 10 20 L -5 7");
    approxCommands(cmds, [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 20 },
      { type: "L", x: -5, y: 7 },
    ]);
  });

  it("expands H / V into L commands carrying the running cursor", () => {
    const cmds = parseSvgPathD("M 5 5 H 20 V 30");
    approxCommands(cmds, [
      { type: "M", x: 5, y: 5 },
      { type: "L", x: 20, y: 5 },
      { type: "L", x: 20, y: 30 },
    ]);
  });

  it("parses C / Q with comma-separated coordinates", () => {
    const cmds = parseSvgPathD("M0,0 C1,2,3,4,5,6 Q7,8,9,10");
    approxCommands(cmds, [
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { type: "Q", x1: 7, y1: 8, x: 9, y: 10 },
    ]);
  });

  it("parses Z (close)", () => {
    const cmds = parseSvgPathD("M 0 0 L 10 0 Z");
    expect(cmds.map((c) => c.type)).toEqual(["M", "L", "Z"]);
  });

  it("parses A with multiple coordinate sets in one segment", () => {
    const cmds = parseSvgPathD("M 0 0 A 10 10 0 0 1 10 10 20 20 0 1 0 30 30");
    expect(cmds.map((c) => c.type)).toEqual(["M", "A", "A"]);
    const a1 = cmds[1];
    const a2 = cmds[2];
    if (a1.type !== "A" || a2.type !== "A") {
      throw new Error("expected two A commands");
    }
    expect(a1.rx).toBe(10);
    expect(a1.largeArc).toBe(false);
    expect(a1.sweep).toBe(true);
    expect(a2.rx).toBe(20);
    expect(a2.largeArc).toBe(true);
    expect(a2.sweep).toBe(false);
    expect(a2.x).toBe(30);
  });
});

describe("pathCommandsToSvgPath", () => {
  it("round-trips every command kind through parseSvgPathD", () => {
    const original: readonly PathCommand[] = [
      { type: "M", x: 1.5, y: 2.5 },
      { type: "L", x: 10, y: 20 },
      { type: "C", x1: 11, y1: 12, x2: 13, y2: 14, x: 15, y: 16 },
      { type: "Q", x1: 17, y1: 18, x: 19, y: 20 },
      {
        type: "A",
        rx: 5,
        ry: 7,
        rotation: 30,
        largeArc: true,
        sweep: false,
        x: 25,
        y: 30,
      },
      { type: "Z" },
    ];
    const d = pathCommandsToSvgPath(original, { precision: 4, separator: " " });
    const parsed = parseSvgPathD(d);
    approxCommands(parsed, original, 1e-3);
  });

  it("honours a bare precision number (backwards compat)", () => {
    const d = pathCommandsToSvgPath([{ type: "M", x: 1.23456, y: 7.89012 }], 2);
    expect(d).toBe("M 1.23 7.89");
  });

  it("emits compact form when separator is empty", () => {
    const d = pathCommandsToSvgPath(
      [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "Z" },
      ],
      { precision: 0, separator: "" },
    );
    expect(d).toBe("M00L100Z");
  });
});

describe("arcToCubicBeziers", () => {
  it("approximates a quarter-circle to within float epsilon", () => {
    // Quarter-circle arc from (1, 0) → (0, 1). With rx=ry=1 and the
    // flags below, the resolved centre is at (0, 0) and every segment
    // endpoint should sit on the unit circle.
    const segs = arcToCubicBeziers({
      x0: 1, y0: 0,
      rxIn: 1, ryIn: 1,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      x: 0, y: 1,
    });
    expect(segs.length).toBeGreaterThan(0);
    const first = segs[0];
    approx(first.x0, 1, 1e-9);
    approx(first.y0, 0, 1e-9);
    const last = segs[segs.length - 1];
    approx(last.x3, 0, 1e-6);
    approx(last.y3, 1, 1e-6);
    // Every segment endpoint sits on the unit circle.
    for (const seg of segs) {
      const r = Math.hypot(seg.x3, seg.y3);
      approx(r, 1, 1e-3);
    }
  });

  it("collapses a zero-length arc to no segments", () => {
    const segs = arcToCubicBeziers({
      x0: 5, y0: 5,
      rxIn: 10, ryIn: 10,
      rotationDeg: 0,
      largeArc: false, sweep: false,
      x: 5, y: 5,
    });
    expect(segs).toEqual([]);
  });

  it("degenerate radii produce a single straight cubic", () => {
    const segs = arcToCubicBeziers({
      x0: 0, y0: 0,
      rxIn: 0, ryIn: 10,
      rotationDeg: 0,
      largeArc: false, sweep: false,
      x: 10, y: 0,
    });
    expect(segs).toHaveLength(1);
    const s = segs[0];
    expect(s.x3).toBe(10);
    expect(s.y3).toBe(0);
  });
});

describe("transformPathCommands", () => {
  const sample: readonly PathCommand[] = [
    { type: "M", x: 1, y: 2 },
    { type: "L", x: 3, y: 4 },
    { type: "C", x1: 5, y1: 6, x2: 7, y2: 8, x: 9, y: 10 },
    { type: "Q", x1: 11, y1: 12, x: 13, y: 14 },
    {
      type: "A",
      rx: 5, ry: 5,
      rotation: 0,
      largeArc: false, sweep: true,
      x: 20, y: 25,
    },
    { type: "Z" },
  ];

  it("identity is idempotent (returns input by reference)", () => {
    const out = transformPathCommands(sample, IDENTITY);
    expect(out).toBe(sample);
  });

  it("undefined transform is idempotent", () => {
    expect(transformPathCommands(sample, undefined)).toBe(sample);
  });

  it("pure translate shifts every endpoint and control point", () => {
    const out = transformPathCommands(sample, {
      m00: 1, m01: 0, m02: 100,
      m10: 0, m11: 1, m12: 200,
    });
    expect(out[0]).toEqual({ type: "M", x: 101, y: 202 });
    expect(out[1]).toEqual({ type: "L", x: 103, y: 204 });
    const c = out[2];
    if (c.type !== "C") { throw new Error(); }
    expect(c.x1).toBe(105);
    expect(c.y2).toBe(208);
    expect(c.x).toBe(109);
  });

  it("90° rotation maps (1, 0) to (0, 1) for endpoints", () => {
    const out = transformPathCommands(
      [{ type: "L", x: 1, y: 0 }],
      { m00: 0, m01: -1, m02: 0, m10: 1, m11: 0, m12: 0 },
    );
    const l = out[0];
    if (l.type !== "L") { throw new Error(); }
    approx(l.x, 0);
    approx(l.y, 1);
  });

  it("non-uniform scale doubles x and triples y on every endpoint", () => {
    const out = transformPathCommands(
      [
        { type: "M", x: 2, y: 4 },
        { type: "L", x: 6, y: 8 },
      ],
      { m00: 2, m01: 0, m02: 0, m10: 0, m11: 3, m12: 0 },
    );
    expect(out).toEqual([
      { type: "M", x: 4, y: 12 },
      { type: "L", x: 12, y: 24 },
    ]);
  });
});

describe("pathCommandsBoundingBox", () => {
  it("returns the zero bbox for an empty input", () => {
    expect(pathCommandsBoundingBox([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("computes bbox for a single L segment", () => {
    const bbox = pathCommandsBoundingBox([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 20 },
    ]);
    expect(bbox).toEqual({ x: 0, y: 0, w: 10, h: 20 });
  });

  it("includes control points that lie outside the endpoint hull", () => {
    const bbox = pathCommandsBoundingBox([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: -5, y1: 50, x2: 25, y2: -10, x: 20, y: 0 },
    ]);
    expect(bbox.x).toBe(-5);
    expect(bbox.y).toBe(-10);
    expect(bbox.w).toBe(30);
    expect(bbox.h).toBe(60);
  });

  it("flattens an Arc into its cubic approximation for bbox computation", () => {
    const bbox = pathCommandsBoundingBox([
      { type: "M", x: 1, y: 0 },
      {
        type: "A",
        rx: 1, ry: 1,
        rotation: 0,
        largeArc: false, sweep: true,
        x: 0, y: 1,
      },
    ]);
    // Quarter-circle arc on the unit circle (centre (0,0)). The
    // control-hull bbox extends slightly past the [0,1]×[0,1] box
    // because cubic Bézier control points sit ~1.027 outside the
    // curve.
    expect(bbox.x).toBeGreaterThanOrEqual(-1e-6);
    expect(bbox.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bbox.w).toBeGreaterThan(0.99);
    expect(bbox.h).toBeGreaterThan(0.99);
    expect(bbox.x + bbox.w).toBeLessThan(1.1);
    expect(bbox.y + bbox.h).toBeLessThan(1.1);
  });
});

describe("primitive contour generators", () => {
  function assertSanity(commands: readonly PathCommand[]): void {
    for (const cmd of commands) {
      if (cmd.type === "M" || cmd.type === "L") {
        expect(Number.isFinite(cmd.x)).toBe(true);
        expect(Number.isFinite(cmd.y)).toBe(true);
        continue;
      }
      if (cmd.type === "C") {
        for (const v of [cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        continue;
      }
      if (cmd.type === "Q") {
        for (const v of [cmd.x1, cmd.y1, cmd.x, cmd.y]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  }

  it("generateRectContour: sharp corners — M, three L, Z; size matches input", () => {
    const c = generateRectContour(50, 30);
    expect(c.commands[0].type).toBe("M");
    expect(c.commands[c.commands.length - 1].type).toBe("Z");
    assertSanity(c.commands);
    const bbox = pathCommandsBoundingBox(c.commands);
    expect(bbox).toEqual({ x: 0, y: 0, w: 50, h: 30 });
  });

  it("generateRectContour: rounded corners — emits cubic Béziers; size still matches", () => {
    const c = generateRectContour(40, 20, 5);
    expect(c.commands.some((cmd) => cmd.type === "C")).toBe(true);
    expect(c.commands[c.commands.length - 1].type).toBe("Z");
    assertSanity(c.commands);
    const bbox = pathCommandsBoundingBox(c.commands);
    expect(bbox.w).toBe(40);
    expect(bbox.h).toBe(20);
  });

  it("generateEllipseContour: four cubics, starts with M, ends with Z, bbox matches", () => {
    const c = generateEllipseContour(80, 40);
    expect(c.commands[0].type).toBe("M");
    expect(c.commands[c.commands.length - 1].type).toBe("Z");
    assertSanity(c.commands);
    const cubicCount = c.commands.filter((cmd) => cmd.type === "C").length;
    expect(cubicCount).toBe(4);
    const bbox = pathCommandsBoundingBox(c.commands);
    expect(bbox.w).toBe(80);
    expect(bbox.h).toBe(40);
  });

  it("generatePolygonContour: pointCount segments, M…L*…Z, bbox matches", () => {
    const c = generatePolygonContour(60, 60, 6);
    expect(c.commands[0].type).toBe("M");
    expect(c.commands[c.commands.length - 1].type).toBe("Z");
    assertSanity(c.commands);
    const lineCount = c.commands.filter((cmd) => cmd.type === "L").length;
    expect(lineCount).toBe(5);
    const bbox = pathCommandsBoundingBox(c.commands);
    expect(bbox.w).toBeGreaterThan(0);
    expect(bbox.h).toBeGreaterThan(0);
  });

  it("generateStarContour: 2·pointCount vertices, starts with M, ends with Z", () => {
    const c = generateStarContour({ width: 50, height: 50, pointCount: 5 });
    expect(c.commands[0].type).toBe("M");
    expect(c.commands[c.commands.length - 1].type).toBe("Z");
    assertSanity(c.commands);
    const segmentCount = c.commands.filter(
      (cmd) => cmd.type === "M" || cmd.type === "L",
    ).length;
    expect(segmentCount).toBe(10);
  });

  it("generateLineContour: M, L, no Z (degenerate)", () => {
    const c = generateLineContour(25);
    expect(c.commands).toEqual([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 25, y: 0 },
    ]);
  });
});
