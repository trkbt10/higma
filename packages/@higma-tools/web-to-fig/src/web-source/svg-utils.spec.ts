/**
 * @file Unit tests for the SVG geometry helpers.
 *
 * These guard the contract every captured icon depends on:
 *
 *   - `parseSvgTransform` understands the SVG transform mini-grammar
 *     (matrix / translate / scale / rotate / skewX / skewY) and
 *     composes a chain of functions in the right order.
 *   - `shapeToPathData` converts each non-path shape into a path
 *     string that matches the original geometry.
 *   - `transformPathData` bakes a 2x3 affine into every coordinate
 *     of a path string, including Bézier control points and arc
 *     end-points, without parsing into a polyline.
 */
import {
  IDENTITY_AFFINE,
  multiplyAffine,
  parseSvgTransform,
  shapeToPathData,
  transformPathData,
  type ShapeAttrs,
} from "./svg-utils";

function attrs(map: Record<string, string>): ShapeAttrs {
  return {
    get(name) {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name]! : null;
    },
  };
}

describe("parseSvgTransform", () => {
  it("returns identity for null / empty / whitespace input", () => {
    expect(parseSvgTransform(null)).toEqual(IDENTITY_AFFINE);
    expect(parseSvgTransform("")).toEqual(IDENTITY_AFFINE);
    expect(parseSvgTransform("   ")).toEqual(IDENTITY_AFFINE);
  });

  it("parses translate(tx, ty) into the matching affine", () => {
    const m = parseSvgTransform("translate(10, 20)");
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  });

  it("parses translate(tx) with implicit ty=0", () => {
    const m = parseSvgTransform("translate(10)");
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 });
  });

  it("parses scale(sx) with sy mirroring sx", () => {
    const m = parseSvgTransform("scale(2)");
    expect(m).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  });

  it("parses scale(sx, sy) preserving non-uniform scaling", () => {
    const m = parseSvgTransform("scale(2 3)");
    expect(m).toEqual({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 });
  });

  it("parses rotate(angle) in degrees as a 2D rotation matrix", () => {
    const m = parseSvgTransform("rotate(90)");
    expect(m.a).toBeCloseTo(0, 5);
    expect(m.b).toBeCloseTo(1, 5);
    expect(m.c).toBeCloseTo(-1, 5);
    expect(m.d).toBeCloseTo(0, 5);
  });

  it("composes a sequence of transforms left-to-right", () => {
    // translate then scale: applying to (1, 0) should give (2, 4) +
    // (5, 6) translation = (7, 6). Equivalent matrix: a=2, e=5, d=4,
    // f=6 (translate is the outer-most function).
    const m = parseSvgTransform("translate(5, 6) scale(2, 4)");
    expect(m.a).toBe(2);
    expect(m.d).toBe(4);
    expect(m.e).toBe(5);
    expect(m.f).toBe(6);
  });

  it("parses matrix(a b c d e f) verbatim", () => {
    const m = parseSvgTransform("matrix(1 2 3 4 5 6)");
    expect(m).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
  });
});

describe("multiplyAffine", () => {
  it("yields the identity when multiplying identity by identity", () => {
    expect(multiplyAffine(IDENTITY_AFFINE, IDENTITY_AFFINE)).toEqual(IDENTITY_AFFINE);
  });

  it("multiplies translate * scale into a single composed matrix", () => {
    const t = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 };
    const s = { a: 2, b: 0, c: 0, d: 4, e: 0, f: 0 };
    expect(multiplyAffine(t, s)).toEqual({ a: 2, b: 0, c: 0, d: 4, e: 5, f: 6 });
  });
});

describe("shapeToPathData — rect", () => {
  it("emits an axis-aligned rect path for a square with no corner radius", () => {
    const d = shapeToPathData("rect", attrs({ x: "10", y: "20", width: "100", height: "60" }));
    expect(d).toBe("M 10 20 H 110 V 80 H 10 Z");
  });

  it("returns undefined for a degenerate rect (non-positive width)", () => {
    expect(shapeToPathData("rect", attrs({ x: "0", y: "0", width: "0", height: "10" }))).toBeUndefined();
  });

  it("emits four cubic Bézier corners for a rounded rect", () => {
    const d = shapeToPathData("rect", attrs({ x: "0", y: "0", width: "100", height: "60", rx: "10" }));
    if (d === undefined) {
      throw new Error("expected rounded rect path");
    }
    expect(d.startsWith("M 10 0")).toBe(true);
    expect(d).toContain("C");
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("shapeToPathData — circle / ellipse / line", () => {
  it("converts <circle> into a four-Bézier closed path", () => {
    const d = shapeToPathData("circle", attrs({ cx: "50", cy: "50", r: "10" }));
    if (d === undefined) {
      throw new Error("expected circle path");
    }
    expect(d.startsWith("M 40 50")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("returns undefined for a circle with non-positive r", () => {
    expect(shapeToPathData("circle", attrs({ cx: "0", cy: "0", r: "0" }))).toBeUndefined();
  });

  it("converts <ellipse> into a four-Bézier closed path with separate rx / ry", () => {
    const d = shapeToPathData("ellipse", attrs({ cx: "0", cy: "0", rx: "20", ry: "10" }));
    if (d === undefined) {
      throw new Error("expected ellipse path");
    }
    expect(d.startsWith("M -20 0")).toBe(true);
  });

  it("converts <line> into an open M..L path", () => {
    const d = shapeToPathData("line", attrs({ x1: "0", y1: "0", x2: "10", y2: "5" }));
    expect(d).toBe("M 0 0 L 10 5");
  });
});

describe("shapeToPathData — polygon / polyline", () => {
  it("emits a closed path for <polygon>", () => {
    const d = shapeToPathData("polygon", attrs({ points: "0,0 10,0 10,10 0,10" }));
    expect(d).toBe("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  });

  it("emits an open path for <polyline>", () => {
    const d = shapeToPathData("polyline", attrs({ points: "0,0 10,0 10,10" }));
    expect(d).toBe("M 0 0 L 10 0 L 10 10");
  });

  it("returns undefined when there are not enough points for a segment", () => {
    expect(shapeToPathData("polygon", attrs({ points: "0,0" }))).toBeUndefined();
  });
});

describe("transformPathData", () => {
  it("returns the input unchanged under the identity matrix", () => {
    const d = "M 0 0 L 10 0 L 10 10 Z";
    expect(transformPathData(d, IDENTITY_AFFINE)).toBe(d);
  });

  it("translates every coordinate of an absolute path", () => {
    const d = "M 0 0 L 10 10";
    const m = parseSvgTransform("translate(5, 7)");
    expect(transformPathData(d, m)).toBe("M 5 7 L 15 17");
  });

  it("translates relative commands by canonicalising them to absolute first", () => {
    const d = "M 0 0 l 10 10";
    const m = parseSvgTransform("translate(5, 7)");
    expect(transformPathData(d, m)).toBe("M 5 7 L 15 17");
  });

  it("scales H/V into L (because horizontal/vertical lines do not survive a non-axis-aligned transform)", () => {
    const d = "M 0 0 H 10 V 10";
    const m = parseSvgTransform("scale(2)");
    expect(transformPathData(d, m)).toBe("M 0 0 L 20 0 L 20 20");
  });

  it("transforms every Bézier control point of a cubic", () => {
    const d = "M 0 0 C 0 5, 5 5, 5 0";
    const m = parseSvgTransform("translate(10, 20)");
    expect(transformPathData(d, m)).toBe("M 10 20 C 10 25 15 25 15 20");
  });

  it("transforms quadratic Bézier control points", () => {
    const d = "M 0 0 Q 5 5 10 0";
    const m = parseSvgTransform("translate(1, 1)");
    expect(transformPathData(d, m)).toBe("M 1 1 Q 6 6 11 1");
  });

  it("preserves Z (closepath) commands verbatim", () => {
    const d = "M 0 0 L 10 0 Z";
    const m = parseSvgTransform("translate(2, 3)");
    expect(transformPathData(d, m)).toBe("M 2 3 L 12 3 Z");
  });

  it("transforms arc end-points and re-fits semi-axes under uniform scaling", () => {
    const d = "M 0 0 A 10 10 0 0 0 20 0";
    const m = parseSvgTransform("scale(2)");
    const result = transformPathData(d, m);
    // End-point doubled; semi-axes doubled; rotation still 0.
    expect(result).toBe("M 0 0 A 20 20 0 0 0 40 0");
  });

  it("expands implicit-repeat lineto commands during the absolute pass", () => {
    // SVG implicit repeat: `M 0 0 10 0 20 0` ≡ `M 0 0 L 10 0 L 20 0`.
    const d = "M 0 0 10 0 20 0";
    expect(transformPathData(d, parseSvgTransform("translate(1, 0)"))).toBe("M 1 0 L 11 0 L 21 0");
  });
});
