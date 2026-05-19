/**
 * @file Tier-1 case `solid-with-radius-shadow` — `baseDiv` + solid bg +
 * uniform radius + drop shadow. The classic "elevated card" composition.
 *
 * Asserts that all three surfaces survive simultaneously — and proves
 * the FRAME corner-radius propagation (one of the bugs the case
 * ladder originally surfaced) holds when other style fields are
 * present.
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_RADIUS_PX, withUniformRadius } from "../corner-radius-uniform/fixture";
import { withDropShadow } from "../shadow-drop/fixture";
import { withSolidBg } from "../solid-bg/fixture";

const composed = withDropShadow(withUniformRadius(withSolidBg(baseDiv())));

describe("case solid-with-radius-shadow — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(composed)));

  it("emits SOLID fill + uniform radius + drop-shadow simultaneously", () => {
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.fills[0]!.kind).toBe("solid");
    expect(frame.style.cornerRadius).toBeDefined();
    expect(frame.style.effects).toHaveLength(1);
    expect(frame.style.effects[0]!.kind).toBe("drop-shadow");
  });
});

describe("case solid-with-radius-shadow — Kiwi FigNode", () => {
  const { context } = buildOne(composed);
  const node = findFigNodeByName(context, "div");

  it("FRAME carries the uniform cornerRadius (not silently dropped)", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.cornerRadius).toBe(DEFAULT_RADIUS_PX);
  });

  it("FRAME carries one effect (the drop-shadow)", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.effects).toHaveLength(1);
  });

  it("FRAME carries one fill (the SOLID bg)", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.fillPaints).toHaveLength(1);
  });
});
