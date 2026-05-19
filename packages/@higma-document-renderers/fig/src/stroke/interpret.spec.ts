/**
 * @file Stroke interpretation SoT tests
 *
 * Verifies the shared stroke functions consumed by both renderers.
 */

import { resolveStrokeWeight, mapStrokeCap, mapStrokeJoin } from "./interpret";
import { STROKE_CAP_VALUES, STROKE_JOIN_VALUES } from "@higma-document-models/fig/constants";

describe("resolveStrokeWeight", () => {
  it("returns 0 for undefined", () => {
    expect(resolveStrokeWeight(undefined)).toBe(0);
  });

  it("returns number directly", () => {
    expect(resolveStrokeWeight(2)).toBe(2);
  });

  it("returns max of per-side weights", () => {
    expect(resolveStrokeWeight({ top: 1, right: 3, bottom: 2, left: 0 })).toBe(3);
  });
});

describe("mapStrokeCap", () => {
  it("maps NONE to butt", () => {
    expect(mapStrokeCap({ value: STROKE_CAP_VALUES.NONE, name: "NONE" })).toBe("butt");
  });

  it("maps ROUND to round", () => {
    expect(mapStrokeCap({ value: STROKE_CAP_VALUES.ROUND, name: "ROUND" })).toBe("round");
  });

  it("maps SQUARE to square", () => {
    expect(mapStrokeCap({ value: STROKE_CAP_VALUES.SQUARE, name: "SQUARE" })).toBe("square");
  });

  it("maps ARROW_LINES to butt (arrows need markers)", () => {
    expect(mapStrokeCap({ value: STROKE_CAP_VALUES.ARROW_LINES, name: "ARROW_LINES" })).toBe("butt");
  });

  it("defaults to butt for unknown", () => {
    expect(mapStrokeCap(undefined)).toBe("butt");
    expect(mapStrokeCap(null)).toBe("butt");
  });
});

describe("mapStrokeJoin", () => {
  it("maps MITER to miter", () => {
    expect(mapStrokeJoin({ value: STROKE_JOIN_VALUES.MITER, name: "MITER" })).toBe("miter");
  });

  it("maps ROUND to round", () => {
    expect(mapStrokeJoin({ value: STROKE_JOIN_VALUES.ROUND, name: "ROUND" })).toBe("round");
  });

  it("maps BEVEL to bevel", () => {
    expect(mapStrokeJoin({ value: STROKE_JOIN_VALUES.BEVEL, name: "BEVEL" })).toBe("bevel");
  });

  it("defaults to miter for unknown", () => {
    expect(mapStrokeJoin(undefined)).toBe("miter");
    expect(mapStrokeJoin(null)).toBe("miter");
  });
});
