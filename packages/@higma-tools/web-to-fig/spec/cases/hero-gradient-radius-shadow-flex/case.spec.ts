/**
 * @file Tier-2 case `hero-gradient-radius-shadow-flex` — gradient
 * survives alongside radius + shadow + column flex.
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../_helpers";
import { DEFAULT_RADIUS_PX } from "../corner-radius-uniform/fixture";
import { heroPanel } from "./fixture";

describe("hero-gradient-radius-shadow-flex — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(heroPanel())));

  it("the hero's only fill is the linear gradient (no SOLID slipped in)", () => {
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.fills[0]!.kind).toBe("linear-gradient");
  });

  it("radius + shadow + column flex all survive", () => {
    expect(frame.style.cornerRadius).toBeDefined();
    expect(frame.style.effects).toHaveLength(1);
    if (frame.autoLayout.direction === "none") {
      throw new Error("expected column autoLayout");
    }
    expect(frame.autoLayout.direction).toBe("column");
  });
});

describe("hero-gradient-radius-shadow-flex — FigDesignNode", () => {
  const { doc } = buildOne(heroPanel());
  const node = findFigNodeByName(doc, "div");

  it("FRAME carries a GRADIENT_LINEAR fill (not SOLID)", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.fills).toHaveLength(1);
    expect(node.fills[0]!.type).toBe("GRADIENT_LINEAR");
  });

  it("FRAME carries the uniform cornerRadius after gradient + shadow + flex stack", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.cornerRadius).toBe(DEFAULT_RADIUS_PX);
  });
});
