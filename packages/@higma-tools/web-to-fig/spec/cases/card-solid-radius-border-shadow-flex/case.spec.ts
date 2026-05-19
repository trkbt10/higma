/**
 * @file Tier-2 case `card-solid-radius-border-shadow-flex` — five
 * primitives composed; every surface lands on the Kiwi FigNode.
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../case-ir-assertions";
import { DEFAULT_BORDER_WIDTH_PX } from "../border-uniform/fixture";
import { DEFAULT_RADIUS_PX } from "../corner-radius-uniform/fixture";
import { DEFAULT_CHILD_COUNT, DEFAULT_GAP_PX } from "../flex-column/fixture";
import { elevatedCard } from "./fixture";

describe("card-solid-radius-border-shadow-flex — IR", () => {
  const frame = asFrame(singleChild(normalizeOne(elevatedCard())));

  it("frame carries every applied surface in IR", () => {
    expect(frame.style.fills).toHaveLength(1);
    expect(frame.style.strokes).toHaveLength(1);
    expect(frame.style.effects).toHaveLength(1);
    expect(frame.style.cornerRadius).toBeDefined();
    expect(frame.autoLayout.direction).toBe("column");
    expect(frame.children).toHaveLength(DEFAULT_CHILD_COUNT);
  });
});

describe("card-solid-radius-border-shadow-flex — Kiwi FigNode", () => {
  const { context } = buildOne(elevatedCard());
  const node = findFigNodeByName(context, "div");

  it("FRAME translates every surface to the corresponding Kiwi FigNode field", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.fillPaints).toHaveLength(1);
    expect(node.strokePaints).toHaveLength(1);
    expect(node.strokeWeight).toBe(DEFAULT_BORDER_WIDTH_PX);
    expect(node.effects).toHaveLength(1);
    expect(node.cornerRadius).toBe(DEFAULT_RADIUS_PX);
    expect(node.stackMode?.name).toBe("VERTICAL");
    expect(node.stackSpacing).toBe(DEFAULT_GAP_PX);
    expect(context.document.childrenOf(node)).toHaveLength(DEFAULT_CHILD_COUNT);
  });
});
