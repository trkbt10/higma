/**
 * @file Unit tests for the strokeGeometry → centerline reconstructor.
 */

import { reconstructStrokeCenterline, type CenterlineContour } from "./stroke-centerline";

type DecodedContour = CenterlineContour;

/**
 * Fixture: a single 1px-wide horizontal stroke from (0,0) to (10,0). The
 * pre-expanded outline is the closed 6-vertex contour:
 *
 *   M (0,0) → A
 *   L (0,-0.5) → A+p
 *   L (10,-0.5) → B+p
 *   L (10,0) → B
 *   L (10,0.5) → B-p
 *   L (0,0.5) → A-p
 *   L (0,0) → A (close)
 */
const horizontalStroke: DecodedContour = {
  commands: [
    { type: "M", x: 0, y: 0 },
    { type: "L", x: 0, y: -0.5 },
    { type: "L", x: 10, y: -0.5 },
    { type: "L", x: 10, y: 0 },
    { type: "L", x: 10, y: 0.5 },
    { type: "L", x: 0, y: 0.5 },
    { type: "L", x: 0, y: 0 },
  ],
  windingRule: "nonzero",
};

describe("reconstructStrokeCenterline", () => {
  it("rebuilds a single-segment centerline from a 6-vertex stroke contour", () => {
    const result = reconstructStrokeCenterline([horizontalStroke], 1);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    const cmds = result![0].commands;
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatchObject({ type: "M", x: 0, y: 0 });
    expect(cmds[1]).toMatchObject({ type: "L", x: 10, y: 0 });
  });

  it("chains two segments sharing an endpoint into a 3-vertex polyline", () => {
    // Chevron-like: (0,0) → (10,10) → (0,20). Each segment is a 6-vertex
    // closed outline rectangle of width 1 (perpendicular offset 0.5/√2).
    const r = 0.5 / Math.SQRT2;
    const seg1: DecodedContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: r, y: -r },
        { type: "L", x: 10 + r, y: 10 - r },
        { type: "L", x: 10, y: 10 },
        { type: "L", x: 10 - r, y: 10 + r },
        { type: "L", x: -r, y: r },
        { type: "L", x: 0, y: 0 },
      ],
      windingRule: "nonzero",
    };
    const seg2: DecodedContour = {
      commands: [
        { type: "M", x: 10, y: 10 },
        { type: "L", x: 10 + r, y: 10 + r },
        { type: "L", x: r, y: 20 + r },
        { type: "L", x: 0, y: 20 },
        { type: "L", x: -r, y: 20 - r },
        { type: "L", x: 10 - r, y: 10 - r },
        { type: "L", x: 10, y: 10 },
      ],
      windingRule: "nonzero",
    };

    const result = reconstructStrokeCenterline([seg1, seg2], 1);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    const pts = result![0].commands;
    expect(pts).toHaveLength(3);
    const xs = pts.map((p) => "x" in p ? p.x : NaN).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs[1]).toBeCloseTo(0, 6);
    expect(xs[2]).toBeCloseTo(10, 6);
  });

  it("rejects shapes that do not match the rectangular-stroke pattern", () => {
    // A regular triangle is not a valid stroke outline.
    const triangle: DecodedContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 5, y: 8.66 },
        { type: "L", x: 0, y: 0 },
      ],
      windingRule: "nonzero",
    };
    expect(reconstructStrokeCenterline([triangle], 1)).toBeUndefined();
  });

  it("rejects a 6-vertex contour whose corners are not at half-width offsets", () => {
    const wrongWidth: DecodedContour = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 0, y: -2 },
        { type: "L", x: 10, y: -2 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 10, y: 2 },
        { type: "L", x: 0, y: 2 },
        { type: "L", x: 0, y: 0 },
      ],
      windingRule: "nonzero",
    };
    expect(reconstructStrokeCenterline([wrongWidth], 1)).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(reconstructStrokeCenterline([], 1)).toBeUndefined();
  });

  it("returns undefined when stroke weight is zero or negative", () => {
    expect(reconstructStrokeCenterline([horizontalStroke], 0)).toBeUndefined();
    expect(reconstructStrokeCenterline([horizontalStroke], -1)).toBeUndefined();
  });

  // Figma's stroke baking emits a thin-stroked circle as a closed
  // contour traversing the outer rim, the inner rim, and the tiny
  // radial bridges between them. The pattern: 4 subpaths (one per
  // quadrant), each containing cubic Bezier arcs at radius R±w/2 plus
  // radial bridges through the centerline radius R. The annulus
  // detector recognises this purely from the geometric invariant
  // "every anchor sits on one of three concentric circles" — it does
  // not pattern-match command counts or specific path-emit byte
  // sequences. App Store template's app-icon mask guide rings hit
  // this case (3 concentric rings per icon × 6 fixtures = 18 baked
  // annuli, all converted to centerline circles for native-stroke
  // emission).
  it("detects a thin circular annulus and emits a centerline circle", () => {
    // Centerline radius 14.414 at center (14.414, 14.414), stroke 0.052.
    // Sample 4 quadrant subpaths with cubic Beziers between the
    // inner-rim (R-w/2) and outer-rim (R+w/2) radii. Bridge points
    // sit at R exactly (the M start / closing L). This is the byte
    // shape Figma's baked vector emits for an app-icon "Mask Outline"
    // guide circle with stroke weight ≈0.0527.
    const R = 14.414;
    const w = 0.052;
    const ri = R - w / 2;
    const ro = R + w / 2;
    const c = R; // path-local center (centroid of the bbox).
    // One quadrant (right → bottom): outer arc out, inner arc back.
    const annulus: DecodedContour = {
      commands: [
        // M centerline-right
        { type: "M", x: c + R, y: c },
        // → inner-right (radial inward bridge)
        { type: "L", x: c + ri, y: c },
        // inner arc to centerline-bottom (synthetic Bezier — only the endpoint matters)
        { type: "C", x1: c + ri, y1: c + ri * 0.5523, x2: c + ri * 0.5523, y2: c + ri, x: c, y: c + ri },
        // → outer-bottom (radial outward bridge)
        { type: "L", x: c, y: c + ro },
        // outer arc back to centerline-right
        { type: "C", x1: c + ro * 0.5523, y1: c + ro, x2: c + ro, y2: c + ro * 0.5523, x: c + ro, y: c },
        { type: "Z" },
        // Quadrant 2 (bottom → left)
        { type: "M", x: c, y: c + R },
        { type: "L", x: c, y: c + ri },
        { type: "C", x1: c - ri * 0.5523, y1: c + ri, x2: c - ri, y2: c + ri * 0.5523, x: c - ri, y: c },
        { type: "L", x: c - ro, y: c },
        { type: "C", x1: c - ro, y1: c + ro * 0.5523, x2: c - ro * 0.5523, y2: c + ro, x: c, y: c + ro },
        { type: "Z" },
        // Quadrant 3 (left → top)
        { type: "M", x: c - R, y: c },
        { type: "L", x: c - ri, y: c },
        { type: "C", x1: c - ri, y1: c - ri * 0.5523, x2: c - ri * 0.5523, y2: c - ri, x: c, y: c - ri },
        { type: "L", x: c, y: c - ro },
        { type: "C", x1: c - ro * 0.5523, y1: c - ro, x2: c - ro, y2: c - ro * 0.5523, x: c - ro, y: c },
        { type: "Z" },
        // Quadrant 4 (top → right)
        { type: "M", x: c, y: c - R },
        { type: "L", x: c, y: c - ri },
        { type: "C", x1: c + ri * 0.5523, y1: c - ri, x2: c + ri, y2: c - ri * 0.5523, x: c + ri, y: c },
        { type: "L", x: c + ro, y: c },
        { type: "C", x1: c + ro, y1: c - ro * 0.5523, x2: c + ro * 0.5523, y2: c - ro, x: c, y: c - ro },
        { type: "Z" },
      ],
      windingRule: "nonzero",
    };
    const result = reconstructStrokeCenterline([annulus], w);
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    const cmds = result![0].commands;
    // Centerline circle: M + 4 cubic Beziers + Z.
    expect(cmds).toHaveLength(6);
    expect(cmds[0].type).toBe("M");
    expect(cmds[1].type).toBe("C");
    expect(cmds[2].type).toBe("C");
    expect(cmds[3].type).toBe("C");
    expect(cmds[4].type).toBe("C");
    expect(cmds[5].type).toBe("Z");
    // Starting point lies on the centerline radius R from the center.
    const start = cmds[0] as { type: "M"; x: number; y: number };
    expect(Math.hypot(start.x - c, start.y - c)).toBeCloseTo(R, 2);
  });

  it("rejects an ellipse-shaped annulus (rx ≠ ry)", () => {
    // Anchor points fall on an ELLIPSE, not a circle — distances from
    // the centroid vary by more than the stroke width, so the
    // detector must reject. This protects ellipses from being
    // collapsed to a circle approximation.
    const rxOuter = 20, ryOuter = 10;
    const ellipse: DecodedContour = {
      commands: [
        { type: "M", x: rxOuter, y: 0 },
        { type: "L", x: 0, y: ryOuter },
        { type: "L", x: -rxOuter, y: 0 },
        { type: "L", x: 0, y: -ryOuter },
        { type: "L", x: rxOuter, y: 0 },
        // inner ellipse rim
        { type: "L", x: rxOuter - 0.05, y: 0 },
        { type: "L", x: 0, y: ryOuter - 0.05 },
        { type: "L", x: -(rxOuter - 0.05), y: 0 },
        { type: "L", x: 0, y: -(ryOuter - 0.05) },
      ],
      windingRule: "nonzero",
    };
    expect(reconstructStrokeCenterline([ellipse], 0.05)).toBeUndefined();
  });
});
