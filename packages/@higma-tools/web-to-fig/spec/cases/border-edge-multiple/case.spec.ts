/**
 * @file Case `border-edge-multiple` — verify the per-edge synth
 * surfaces *every* visible edge as a separate FRAME, not just the
 * dominant one. Two edges authored ⇒ two children.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { divWithTopBottomBorder } from "./fixture";

describe("case border-edge-multiple", () => {
  const frame = asFrame(singleChild(normalizeOne(divWithTopBottomBorder())));

  it("does NOT emit a perimeter stroke (border is asymmetric)", () => {
    expect(frame.style.strokes).toHaveLength(0);
  });

  it("synthesises both top and bottom edge FRAMEs", () => {
    const edges = frame.children.filter((c) => c.name.startsWith("border-"));
    expect(edges).toHaveLength(2);
    const sides = new Set(edges.map((e) => e.name));
    expect(sides.has("border-top")).toBe(true);
    expect(sides.has("border-bottom")).toBe(true);
  });

  it("each edge FRAME spans the full width and 1px height", () => {
    for (const c of frame.children) {
      if (!c.name.startsWith("border-")) {continue;}
      if (c.kind !== "frame") {throw new Error("expected frame edge");}
      expect(c.box.width).toBe(200);
      expect(c.box.height).toBe(1);
    }
  });

  it("the bottom edge FRAME sits at y = host height − edge width", () => {
    const bottom = frame.children.find((c) => c.name === "border-bottom");
    if (!bottom || bottom.kind !== "frame") {
      throw new Error("expected border-bottom edge");
    }
    expect(bottom.box.y).toBe(79);
  });
});
