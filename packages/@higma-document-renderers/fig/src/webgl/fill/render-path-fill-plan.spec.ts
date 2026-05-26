/** @file Tests for WebGL path fill planning from RenderTree contours. */

import type { RenderPathContour } from "../../scene-graph";
import { createWebGLPathFillPlan } from "./render-path-fill-plan";

describe("createWebGLPathFillPlan", () => {
  it("keeps each RenderPathContour as a separate WebGL fill instruction", () => {
    const paths: RenderPathContour[] = [
      { d: "M0 0H10V10H0Z" },
      { d: "M20 0H30V10H20Z" },
      { d: "M40 0H50V10H40Z" },
      { d: "M60 0H70V10H60Z" },
      { d: "M80 0H90V10H80Z" },
    ];

    const plan = createWebGLPathFillPlan({ paths });

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

    const plan = createWebGLPathFillPlan({ paths });

    expect(plan.map((instruction) => instruction.fillRule)).toEqual(["evenodd", "nonzero"]);
    expect(plan[0].contours[0].windingRule).toBe("evenodd");
    expect(plan[1].contours[0].windingRule).toBe("nonzero");
  });

  it("preserves per-contour fillOverride without resolving paint in the geometry plan", () => {
    const fillOverride = {
      attrs: { fill: "#336699", fillOpacity: 0.4 },
    };
    const paths: RenderPathContour[] = [
      { d: "M0 0H10V10H0Z", fillOverride },
    ];

    const plan = createWebGLPathFillPlan({ paths });

    expect(plan[0].fillOverride).toBe(fillOverride);
  });
});
