/**
 * @file Tier-2 case `card-solid-radius-border-shadow-flex` — five
 * primitives composed; every surface lands on the FigDesignNode.
 */
import { asFrame, buildOne, findFigNodeByName, normalizeOne, singleChild } from "../_helpers";
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

describe("card-solid-radius-border-shadow-flex — FigDesignNode", () => {
  const { doc } = buildOne(elevatedCard());
  const node = findFigNodeByName(doc, "div");

  it("FRAME translates every surface to the corresponding FigDesignNode field", () => {
    if (!node) {
      throw new Error("div not found");
    }
    expect(node.fills).toHaveLength(1);
    expect(node.strokes).toHaveLength(1);
    expect(node.strokeWeight).toBe(DEFAULT_BORDER_WIDTH_PX);
    expect(node.effects).toHaveLength(1);
    expect(node.cornerRadius).toBe(DEFAULT_RADIUS_PX);
    expect(node.autoLayout?.stackMode.name).toBe("VERTICAL");
    expect(node.autoLayout?.stackSpacing).toBe(DEFAULT_GAP_PX);
    expect(node.children).toHaveLength(DEFAULT_CHILD_COUNT);
  });
});
