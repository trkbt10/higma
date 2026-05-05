/** @file Tests for WebGL path fill planning from RenderTree contours. */

import type { Fill } from "../scene-graph/types";
import type { RenderPathContour } from "../scene-graph/render-tree";
import { createWebGLPathFillPlan, resolvedFillOverrideToWebGLFills } from "./render-path-fill-plan";

const whiteFill: Fill = {
  type: "solid",
  color: { r: 1, g: 1, b: 1, a: 1 },
  opacity: 1,
};

describe("createWebGLPathFillPlan", () => {
  it("keeps each RenderPathContour as a separate WebGL fill instruction", () => {
    const paths: RenderPathContour[] = [
      { d: "M0 0H10V10H0Z" },
      { d: "M20 0H30V10H20Z" },
      { d: "M40 0H50V10H40Z" },
      { d: "M60 0H70V10H60Z" },
      { d: "M80 0H90V10H80Z" },
    ];

    const plan = createWebGLPathFillPlan({ paths, sourceFills: [whiteFill] });

    expect(plan).toHaveLength(5);
    expect(plan.map((instruction) => instruction.fillRule)).toEqual([
      "nonzero",
      "nonzero",
      "nonzero",
      "nonzero",
      "nonzero",
    ]);
    expect(plan.every((instruction) => instruction.contours.length === 1)).toBe(true);
  });

  it("preserves contour fill rules from RenderTree instead of resolving them again in WebGL", () => {
    const paths: RenderPathContour[] = [
      { d: "M0 0H10V10H0Z", fillRule: "evenodd" },
      { d: "M20 0H30V10H20Z" },
    ];

    const plan = createWebGLPathFillPlan({ paths, sourceFills: [whiteFill] });

    expect(plan.map((instruction) => instruction.fillRule)).toEqual(["evenodd", "nonzero"]);
    expect(plan[0].contours[0].windingRule).toBe("evenodd");
    expect(plan[1].contours[0].windingRule).toBe("nonzero");
  });

  it("uses per-contour fillOverride as the path-level paint SoT", () => {
    const sourceFills: Fill[] = [whiteFill];

    const result = resolvedFillOverrideToWebGLFills({
      attrs: { fill: "#336699", fillOpacity: 0.4 },
    }, sourceFills);

    expect(result).toEqual({ fills: [{
      type: "solid",
      color: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      opacity: 0.4,
    }] });
  });

  it("keeps fill=none as an empty paint list for that contour", () => {
    const result = resolvedFillOverrideToWebGLFills({
      attrs: { fill: "none" },
    }, [whiteFill]);

    expect(result).toEqual({ fills: [] });
  });

  it("throws on unsupported fillOverride", () => {
    expect(() => resolvedFillOverrideToWebGLFills({
      attrs: { fill: "url(#paint-unsupported)" },
    }, [whiteFill])).toThrow("WebGL path fill plan does not support fillOverride url(#paint-unsupported)");
  });
});
